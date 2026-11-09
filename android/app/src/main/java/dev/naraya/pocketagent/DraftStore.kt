package dev.naraya.pocketagent

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Only synthetic/public repository draft metadata. No secrets, accounts or customer data. */
data class MonitorDraft(
    val id: String,
    val repository: String,
    val intervalMinutes: Int,
    val createdAt: Long,
)

class DraftStore(context: Context) {
    private val prefs = context.getSharedPreferences("public_monitor_drafts_v1", Context.MODE_PRIVATE)
    private val key = "items"

    fun list(): List<MonitorDraft> {
        return try {
            val serialized = JSONArray(prefs.getString(key, "[]") ?: "[]")
            val drafts = mutableListOf<MonitorDraft>()
            for (i in 0 until minOf(serialized.length(), 20)) {
                val item = serialized.getJSONObject(i)
                val repo = RepoRules.normalize(item.getString("repository")) ?: continue
                val interval = item.getInt("interval")
                if (interval !in listOf(30, 60, 120, 240, 1440)) continue
                drafts.add(MonitorDraft(
                    id = item.getString("id"),
                    repository = repo,
                    intervalMinutes = interval,
                    createdAt = item.getLong("created"),
                ))
            }
            drafts
        } catch (_: Exception) {
            emptyList() // No corrupt persisted data is ever sent to a provider.
        }
    }

    fun add(repository: String, intervalMinutes: Int): Boolean {
        val canonical = RepoRules.normalize(repository) ?: return false
        if (intervalMinutes !in listOf(30, 60, 120, 240, 1440)) return false
        val current = list()
        if (current.size >= 20 || current.any { it.repository == canonical }) return false
        return save(listOf(MonitorDraft(UUID.randomUUID().toString(), canonical, intervalMinutes, System.currentTimeMillis())) + current)
    }

    fun remove(id: String): Boolean = save(list().filterNot { it.id == id })

    private fun save(items: List<MonitorDraft>): Boolean {
        val array = JSONArray()
        items.take(20).forEach { item ->
            array.put(JSONObject().apply {
                put("id", item.id)
                put("repository", item.repository)
                put("interval", item.intervalMinutes)
                put("created", item.createdAt)
            })
        }
        // commit() is synchronous: do not claim persistence before confirmation.
        return prefs.edit().putString(key, array.toString()).commit()
    }
}
