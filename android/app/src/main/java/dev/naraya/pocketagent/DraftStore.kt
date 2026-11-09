package dev.naraya.pocketagent

import android.content.Context
import java.util.UUID

/**
 * Small, non-sensitive public repository draft cache. Nothing here authorizes
 * remote Cloudflare actions or contains an account/access token.
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
    // Preserve previous alpha's preference key through the V2 schema transition.
    private val prefs = context.getSharedPreferences("public_monitor_drafts_v1", Context.MODE_PRIVATE)
    private val key = "items"
    private val shaRegex = Regex("^[a-f0-9]{40}$")

    fun list(): List<MonitorDraft> = DraftCodec.decode(prefs.getString(key, "[]") ?: "[]")

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
        if (!shaRegex.matches(sha) || checkedAt <= 0L) return false
        val current = list()
        val found = current.firstOrNull { it.id == id } ?: return false
        if (found.lastCheckedAt != null && checkedAt < found.lastCheckedAt) return false
        return save(current.map {
            if (it.id == id) it.copy(lastHeadSha = sha, lastCheckedAt = checkedAt) else it
        })
    }

    private fun save(items: List<MonitorDraft>): Boolean {
        // commit() is synchronous and reports storage failure; payload <= 20 public drafts.
        return prefs.edit().putString(key, DraftCodec.encode(items)).commit()
    }
}
