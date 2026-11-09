package dev.naraya.pocketagent

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Stores only public repository names and last known public commit SHA.
 * No provider tokens, phone contacts, user accounts or customer data.
 */
data class MonitorDraft(
    val id: String,
    val repository: String,
    val intervalMinutes: Int,
    val createdAt: Long,
    val lastHeadSha: String? = null,
    val lastCheckedAt: Long? = null,
)

class DraftStore(context: Context) {
    // Same preference key as P1-A so existing draft lists survive APK upgrades.
    private val prefs = context.getSharedPreferences("public_monitor_drafts_v1", Context.MODE_PRIVATE)
    private val key = "items"
    private val shaRegex = Regex("^[a-f0-9]{40}$")

    fun list(): List<MonitorDraft> {
        return try {
            val serialized = JSONArray(prefs.getString(key, "[]") ?: "[]")
            val drafts = mutableListOf<MonitorDraft>()
            for (i in 0 until minOf(serialized.length(), 20)) {
                val item = serialized.getJSONObject(i)
                val repo = RepoRules.normalize(item.getString("repository")) ?: continue
                val interval = item.getInt("interval")
                if (interval !in listOf(30, 60, 120, 240, 1440)) continue
                val sha = item.optString("last_head", "").takeIf { shaRegex.matches(it) }
                val checked = item.optLong("last_checked", 0L).takeIf { it > 0 }
                drafts.add(MonitorDraft(
                    id = item.getString("id"),
                    repository = repo,
                    intervalMinutes = interval,
                    createdAt = item.getLong("created"),
                    lastHeadSha = if (checked != null) sha else null,
                    lastCheckedAt = if (sha != null) checked else null,
                ))
            }
            drafts
        } catch (_: Exception) {
            emptyList() // Corrupt records are never forwarded to GitHub.
        }
    }

    fun add(repository: String, intervalMinutes: Int): Boolean {
        val canonical = RepoRules.normalize(repository) ?: return false
        if (intervalMinutes !in listOf(30, 60, 120, 240, 1440)) return false
        val current = list()
        if (current.size >= 20 || current.any { it.repository == canonical }) return false
        return save(listOf(MonitorDraft(UUID.randomUUID().toString(), canonical, intervalMinutes, System.currentTimeMillis())) + current)
    }

    fun remove(id: String): Boolean {
        val current = list()
        if (current.none { it.id == id }) return false
        return save(current.filterNot { it.id == id })
    }

    fun recordHead(id: String, sha: String, checkedAt: Long): Boolean {
        if (!shaRegex.matches(sha) || checkedAt <= 0) return false
        val current = list()
        val found = current.firstOrNull { it.id == id } ?: return false
        if (found.lastCheckedAt != null && checkedAt < found.lastCheckedAt) return false
        return save(current.map {
            if (it.id == id) it.copy(lastHeadSha = sha, lastCheckedAt = checkedAt) else it
        })
    }

    private fun save(items: List<MonitorDraft>): Boolean {
        val array = JSONArray()
        items.take(20).forEach { item ->
            array.put(JSONObject().apply {
                put("id", item.id)
                put("repository", item.repository)
                put("interval", item.intervalMinutes)
                put("created", item.createdAt)
                if (item.lastHeadSha != null && item.lastCheckedAt != null) {
                    put("last_head", item.lastHeadSha)
                    put("last_checked", item.lastCheckedAt)
                }
            })
        }
        return prefs.edit().putString(key, array.toString()).commit()
    }
}
