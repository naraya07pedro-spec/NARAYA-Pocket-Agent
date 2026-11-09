package dev.naraya.pocketagent

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Version-tolerant codec. P1-A records without last_head/last_checked migrate
 * on read; a malformed individual record cannot erase valid neighbors.
 */
internal object DraftCodec {
    private val shaRegex = Regex("^[a-f0-9]{40}$")
    private val intervals = setOf(30, 60, 120, 240, 1440)

    fun decode(raw: String): List<MonitorDraft> {
        val array = try { JSONArray(raw) } catch (_: Exception) { return emptyList() }
        val output = mutableListOf<MonitorDraft>()
        val seen = mutableSetOf<String>()
        for (index in 0 until array.length()) {
            if (output.size >= 20) break
            val obj = array.optJSONObject(index) ?: continue
            try {
                val id = UUID.fromString(obj.getString("id")).toString()
                val repository = RepoRules.normalize(obj.getString("repository")) ?: continue
                val interval = obj.getInt("interval")
                if (interval !in intervals || repository in seen) continue
                val created = obj.getLong("created")
                if (created <= 0L) continue

                val head = obj.optString("last_head", "").takeIf { shaRegex.matches(it) }
                val checked = obj.optLong("last_checked", 0L).takeIf { it > 0L }
                output.add(MonitorDraft(
                    id = id, repository = repository, intervalMinutes = interval,
                    createdAt = created, lastHeadSha = if (checked != null) head else null,
                    lastCheckedAt = if (head != null) checked else null,
                ))
                seen.add(repository)
            } catch (_: Exception) {
                // Skip just this malformed record, retaining all valid neighbors.
            }
        }
        return output
    }

    fun encode(items: List<MonitorDraft>): String {
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
        return array.toString()
    }
}
