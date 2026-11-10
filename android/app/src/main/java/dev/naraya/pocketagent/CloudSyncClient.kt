package dev.naraya.pocketagent

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * Manual Android-to-Worker connector. The only authority is a short-lived Google
 * ID token obtained interactively on device; NEVER the operator bearer secret.
 * No token, server response or owner identifier is written to SharedPreferences.
 */
internal data class CloudMonitor(
    val id: String,
    val clientDraftId: String,
    val repository: String,
    val intervalMinutes: Int,
    val status: String,
    val version: Int,
    val lastSha: String?,
    val lastCheckedAt: Long?,
    // These are last-response source assertions, NOT verified remote execution.
    val schedulerEligible: Boolean,
    val scheduled: Boolean,
)

/**
 * Honest user-facing distinction between stored state, last known scheduling
 * configuration and physical/remote execution proof. Never infer a running
 * Cron from ACTIVE or schedulerEligible alone.
 */
internal fun CloudMonitor.executionSummary(): String = when {
    status == "PAUSED" -> "PAUSED (last server snapshot). No execution is authorized."
    !schedulerEligible -> "Stored ACTIVE, but scheduler eligibility is OFF in the last server snapshot."
    scheduled -> "Server reports scheduled; physical phone-off execution is NOT independently verified."
    else -> "Stored ACTIVE and configuration-eligible; remote Cron execution is NOT verified."
}

internal enum class SyncFailure {
    NOT_CONFIGURED, SIGN_IN_REQUIRED, UNAUTHORIZED, RATE_LIMITED, CONFLICT, NOT_FOUND,
    SCHEDULER_DISABLED, SCHEDULER_STORAGE_UNAVAILABLE, STALE_VERSION, ACTIVE_LIMIT,
    UNAVAILABLE, INVALID_SERVER_RESPONSE, NETWORK_ERROR
}

internal data class CloudObservation(
    val id: String,
    val monitorId: String,
    val type: String,
    val previousSha: String?,
    val headSha: String,
    val observedAt: Long,
)

internal sealed interface SyncResult {
    data class Uploaded(val monitor: CloudMonitor, val created: Boolean) : SyncResult
    data class Listed(val monitors: List<CloudMonitor>) : SyncResult
    data class StatusChanged(val monitorId: String, val status: String, val version: Int,
                             val schedulerEligible: Boolean) : SyncResult
    data class Observed(val monitorId: String, val observations: List<CloudObservation>) : SyncResult
    data class Failed(val code: SyncFailure) : SyncResult
}

/**
 * Keep the on-screen monitor derived from the verified versioned server ACK.
 * Never leave a stale eligible=true flag after a confirmed PAUSE, or infer
 * scheduling from a successful status change.
 */
internal fun CloudMonitor.withConfirmedStatus(change: SyncResult.StatusChanged): CloudMonitor? {
    if (change.monitorId != id || change.version != version + 1 ||
        change.status !in listOf("ACTIVE", "PAUSED") || change.status == status ||
        change.schedulerEligible != (change.status == "ACTIVE")) return null
    return copy(status = change.status, version = change.version,
        schedulerEligible = change.schedulerEligible, scheduled = false)
}

internal data class SyncHttpResponse(val status: Int, val body: String)
internal fun interface SyncTransport {
    fun execute(origin: String, path: String, method: String, token: String, jsonBody: String?): SyncHttpResponse
}

internal object WorkerSyncTransport : SyncTransport {
    private const val MAX_BODY = 16_384
    override fun execute(origin: String, path: String, method: String, token: String, jsonBody: String?): SyncHttpResponse {
        require(CloudSyncClient.validOrigin(origin))
        require(CloudSyncClient.allowedRoute(path, method))
        require(token.length <= 8192)
        val parsed = URL(origin + path)
        val connection = parsed.openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 6_000
        connection.readTimeout = 6_000
        connection.useCaches = false
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("Accept", "application/json")
        if (method == "POST" || method == "PATCH") {
            require(jsonBody != null && jsonBody.toByteArray(StandardCharsets.UTF_8).size <= 4096)
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
        } else require(jsonBody == null)
        try {
            if (method == "POST" || method == "PATCH") {
                connection.outputStream.use { it.write(jsonBody!!.toByteArray(StandardCharsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (status == 409 || status == 503) {
                val stream = connection.errorStream ?: return SyncHttpResponse(status, "")
                if (connection.contentLengthLong > 2_048) return SyncHttpResponse(status, "")
                val bytes = stream.use { readBounded(it, 2_048) }
                val utf8 = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                return SyncHttpResponse(status, utf8.decode(ByteBuffer.wrap(bytes)).toString())
            }
            if (status !in listOf(200, 201)) return SyncHttpResponse(status, "")
            if (connection.contentLengthLong > MAX_BODY) throw InvalidProviderBody()
            val bytes = connection.inputStream.use { readBounded(it, MAX_BODY) }
            val decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            return SyncHttpResponse(status, decoder.decode(ByteBuffer.wrap(bytes)).toString())
        } finally {
            connection.disconnect()
        }
    }
}

internal class EphemeralIdToken {
    private var value: String? = null

    fun replace(token: String): Boolean {
        value = if (CloudSyncClient.validIdTokenShape(token)) token else null
        return value != null
    }

    fun read(): String? = value
    fun clear() { value = null }
}

internal class CloudSyncClient(
    private val origin: String,
    private val transport: SyncTransport = WorkerSyncTransport,
) {
    companion object {
        private val tokenPattern = Regex("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$")
        private val uuidPattern = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
        private val shaPattern = Regex("^[0-9a-f]{40}$")
        private val monitorPath = Regex("^/v1/sync/monitors/[0-9a-f-]{36}$", RegexOption.IGNORE_CASE)
        private val observationPath = Regex("^/v1/sync/observations\\?monitorId=[0-9a-f-]{36}$",
            RegexOption.IGNORE_CASE)
        fun allowedRoute(path: String, method: String): Boolean = when (method) {
            "GET" -> path == "/v1/sync/monitors" || (observationPath.matches(path) &&
                uuid(path.substringAfter("monitorId=")) != null)
            "POST" -> path == "/v1/sync/monitors"
            "PATCH" -> monitorPath.matches(path) && uuid(path.substringAfterLast('/')) != null
            else -> false
        }
        fun validIdTokenShape(token: String?): Boolean =
            token != null && token.length in 120..8192 && tokenPattern.matches(token)
        fun validOrigin(origin: String): Boolean = try {
            val parsed = URL(origin)
            parsed.protocol == "https" && parsed.host.isNotBlank() &&
                parsed.port == -1 && parsed.userInfo == null && parsed.ref == null &&
                parsed.query == null && (parsed.path == "" || parsed.path == "/") &&
                !origin.endsWith("/") && origin == "https://" + parsed.host &&
                parsed.host.matches(Regex("^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$"))
        } catch (_: Exception) { false }
        private fun uuid(value: String): String? = try {
            if (!uuidPattern.matches(value)) null else UUID.fromString(value).toString()
        } catch (_: Exception) { null }

        private fun parseMonitor(obj: JSONObject): CloudMonitor? {
            return try {
            val id = uuid(obj.getString("id")) ?: return null
            val clientDraftId = uuid(obj.getString("clientDraftId")) ?: return null
            val repo = RepoRules.normalize(obj.getString("repository")) ?: return null
            val interval = obj.getInt("intervalMinutes")
            // The server permits every 15-minute increment from 30 to 1440.
            // UI-created local drafts still intentionally offer fewer presets.
            if (interval !in 30..1440 || interval % 15 != 0) return null
            val status = obj.getString("status")
            if (status !in listOf("ACTIVE", "PAUSED")) return null
            val version = obj.getInt("version")
            if (version <= 0) return null
            val head = if (obj.isNull("lastSha") || !obj.has("lastSha")) null else obj.getString("lastSha")
            if (head != null && !shaPattern.matches(head)) return null
            val checkedAt = if (obj.isNull("lastCheckedAt") || !obj.has("lastCheckedAt"))
                null else obj.getLong("lastCheckedAt")
            if (checkedAt != null && checkedAt <= 0L) return null
            // org.json.getBoolean accepts strings like "true"; reject those.
            // Missing or malformed server flags cannot be silently guessed.
            val eligibility = obj.get("schedulerEligible")
            val scheduling = obj.get("scheduled")
            if (eligibility !is Boolean || scheduling !is Boolean) return null
            if (status == "PAUSED" && (eligibility || scheduling)) return null
            if (scheduling && !eligibility) return null
            CloudMonitor(id, clientDraftId, repo, interval, status, version, head, checkedAt,
                eligibility, scheduling)
            } catch (_: Exception) { null }
        }
    }

    private sealed interface RawExchange
    private data class RawSuccess(val status: Int, val body: String) : RawExchange
    private data class RawFailure(val code: SyncFailure) : RawExchange

    private fun exchange(token: String?, method: String, path: String, body: String?): RawExchange {
        if (!validOrigin(origin)) return RawFailure(SyncFailure.NOT_CONFIGURED)
        if (!validIdTokenShape(token)) return RawFailure(SyncFailure.SIGN_IN_REQUIRED)
        if (!allowedRoute(path, method)) return RawFailure(SyncFailure.INVALID_SERVER_RESPONSE)
        return try {
            val response = transport.execute(origin, path, method, token!!, body)
            when (response.status) {
                200, 201 -> {
                    if (response.body.toByteArray(StandardCharsets.UTF_8).size > 16_384)
                        RawFailure(SyncFailure.INVALID_SERVER_RESPONSE)
                    else RawSuccess(response.status, response.body)
                }
                401, 403 -> RawFailure(SyncFailure.UNAUTHORIZED)
                404 -> RawFailure(SyncFailure.NOT_FOUND)
                409 -> {
                    // Only server-defined finite error codes are surfaced; never echo raw upstream text.
                    val code = try { JSONObject(response.body).optString("error") } catch (_: Exception) { "" }
                    RawFailure(when (code) {
                        "scheduler_disabled" -> SyncFailure.SCHEDULER_DISABLED
                        "stale_version" -> SyncFailure.STALE_VERSION
                        "active_monitor_limit" -> SyncFailure.ACTIVE_LIMIT
                        else -> SyncFailure.CONFLICT
                    })
                }
                429 -> RawFailure(SyncFailure.RATE_LIMITED)
                503 -> {
                    // Only a fixed, server-owned error code may be surfaced.
                    // Raw remote diagnostics, bearer data or arbitrary bodies
                    // are never added to UI-visible messages.
                    val code = try { JSONObject(response.body).optString("error") }
                        catch (_: Exception) { "" }
                    RawFailure(if (code == "scheduler_storage_unavailable")
                        SyncFailure.SCHEDULER_STORAGE_UNAVAILABLE else SyncFailure.UNAVAILABLE)
                }
                else -> RawFailure(SyncFailure.UNAVAILABLE)
            }
        } catch (_: InvalidProviderBody) {
            RawFailure(SyncFailure.INVALID_SERVER_RESPONSE)
        } catch (_: CharacterCodingException) {
            RawFailure(SyncFailure.INVALID_SERVER_RESPONSE)
        } catch (_: IOException) {
            RawFailure(SyncFailure.NETWORK_ERROR)
        } catch (_: SecurityException) {
            RawFailure(SyncFailure.NETWORK_ERROR)
        } catch (_: Exception) {
            RawFailure(SyncFailure.INVALID_SERVER_RESPONSE)
        }
    }

    private fun request(token: String?, method: String, body: String?): SyncResult {
        val result = exchange(token, method, "/v1/sync/monitors", body)
        if (result !is RawSuccess) return when (result) {
            is RawFailure -> SyncResult.Failed(result.code)
            else -> SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        }
        return try {
            val response = SyncHttpResponse(result.status, result.body)
            when (response.status) {
                200, 201 -> {
                    if (response.body.toByteArray(StandardCharsets.UTF_8).size > 16_384)
                        return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                    val data = JSONObject(response.body)
                    if (method == "POST") {
                        val monitor = parseMonitor(data.getJSONObject("monitor"))
                            ?: return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                        val created = data.getBoolean("created")
                        if ((response.status == 201) != created ||
                            (created && monitor.status != "PAUSED"))
                            return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                        SyncResult.Uploaded(monitor, created)
                    } else {
                        val array: JSONArray = data.getJSONArray("monitors")
                        if (array.length() > 3) return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                        val monitors = (0 until array.length()).map { index ->
                            parseMonitor(array.getJSONObject(index))
                                ?: return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                        }
                        if (monitors.map { it.clientDraftId }.toSet().size != monitors.size)
                            return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                        SyncResult.Listed(monitors)
                    }
                }
                else -> SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
            }
        } catch (_: InvalidProviderBody) {
            SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        } catch (_: CharacterCodingException) {
            SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        } catch (_: IOException) {
            SyncResult.Failed(SyncFailure.NETWORK_ERROR)
        } catch (_: SecurityException) {
            SyncResult.Failed(SyncFailure.NETWORK_ERROR)
        } catch (_: Exception) {
            SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        }
    }

    /** One explicit user action means exactly one POST, with the preexisting durable draft UUID. */
    fun upload(token: String?, draft: MonitorDraft): SyncResult {
        val canonical = RepoRules.normalize(draft.repository)
            ?: return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        val id = uuid(draft.id) ?: return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        if (draft.intervalMinutes !in listOf(30, 60, 120, 240, 1440))
            return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        val body = JSONObject().put("clientDraftId", id)
            .put("repository", canonical)
            .put("intervalMinutes", draft.intervalMinutes).toString()
        return when (val result = request(token, "POST", body)) {
            is SyncResult.Uploaded -> if (result.monitor.clientDraftId == id &&
                result.monitor.repository == canonical && result.monitor.intervalMinutes == draft.intervalMinutes)
                result else SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
            else -> result
        }
    }

    /** Read-only reconciliation, no speculative local CLOUD success on network errors. */
    fun list(token: String?): SyncResult = request(token, "GET", null)

    /** Versioned, owner-authorized server status mutation. Never infer success from a 409. */
    fun changeStatus(token: String?, monitor: CloudMonitor, status: String): SyncResult {
        val id = uuid(monitor.id) ?: return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        if (status !in listOf("ACTIVE", "PAUSED") || monitor.status !in listOf("ACTIVE", "PAUSED") ||
            status == monitor.status || monitor.version < 1) {
            return SyncResult.Failed(SyncFailure.CONFLICT)
        }
        val json = JSONObject().put("status", status).put("expectedVersion", monitor.version).toString()
        val result = exchange(token, "PATCH", "/v1/sync/monitors/$id", json)
        if (result !is RawSuccess) return when (result) {
            is RawFailure -> SyncResult.Failed(result.code)
            else -> SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        }
        if (result.status != 200) return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        return try {
            val body = JSONObject(result.body)
            val resultId = uuid(body.getString("id"))
            val actualStatus = body.getString("status")
            val version = body.getInt("version")
            val eligible = body.getBoolean("schedulerEligible")
            if (resultId != id || actualStatus != status || version != monitor.version + 1 ||
                eligible != (status == "ACTIVE")) {
                SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
            } else SyncResult.StatusChanged(id, status, version, eligible)
        } catch (_: Exception) {
            SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        }
    }

    /** Observations are remote evidence, never synthesized from a local clock or cache. */
    fun observations(token: String?, monitorId: String): SyncResult {
        val id = uuid(monitorId) ?: return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        val result = exchange(token, "GET", "/v1/sync/observations?monitorId=$id", null)
        if (result !is RawSuccess) return when (result) {
            is RawFailure -> SyncResult.Failed(result.code)
            else -> SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        }
        if (result.status != 200) return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        return try {
            val array = JSONObject(result.body).getJSONArray("observations")
            if (array.length() > 50) return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
            val output = ArrayList<CloudObservation>()
            val seen = HashSet<String>()
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                val eventId = uuid(item.getString("id"))
                    ?: return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                val eventMonitorId = uuid(item.getString("monitor_id"))
                    ?: return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                val type = item.getString("event_type")
                val sha = item.getString("head_sha")
                val previous = if (item.isNull("previous_sha") || !item.has("previous_sha")) null
                    else item.getString("previous_sha")
                val observedAt = item.getLong("observed_at")
                if (eventId in seen || eventMonitorId != id || type !in listOf("BASELINE", "CHANGE") ||
                    !shaPattern.matches(sha) || (previous != null && !shaPattern.matches(previous)) ||
                    observedAt <= 0L || (output.isNotEmpty() && observedAt > output.last().observedAt) ||
                    (type == "BASELINE" && previous != null) || (type == "CHANGE" && previous == null)) {
                    return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                }
                seen.add(eventId)
                output.add(CloudObservation(eventId, id, type, previous, sha, observedAt))
            }
            SyncResult.Observed(id, output)
        } catch (_: Exception) {
            SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
        }
    }
}
