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
)

internal enum class SyncFailure {
    NOT_CONFIGURED, SIGN_IN_REQUIRED, UNAUTHORIZED, RATE_LIMITED, CONFLICT,
    UNAVAILABLE, INVALID_SERVER_RESPONSE, NETWORK_ERROR
}

internal sealed interface SyncResult {
    data class Uploaded(val monitor: CloudMonitor, val created: Boolean) : SyncResult
    data class Listed(val monitors: List<CloudMonitor>) : SyncResult
    data class Failed(val code: SyncFailure) : SyncResult
}

internal data class SyncHttpResponse(val status: Int, val body: String)
internal fun interface SyncTransport {
    fun execute(origin: String, path: String, method: String, token: String, jsonBody: String?): SyncHttpResponse
}

internal object WorkerSyncTransport : SyncTransport {
    private const val MAX_BODY = 16_384
    override fun execute(origin: String, path: String, method: String, token: String, jsonBody: String?): SyncHttpResponse {
        require(CloudSyncClient.validOrigin(origin) && (method == "GET" || method == "POST"))
        require(path == "/v1/sync/monitors")
        val parsed = URL(origin + path)
        val connection = parsed.openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 6_000
        connection.readTimeout = 6_000
        connection.useCaches = false
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("Accept", "application/json")
        if (method == "POST") {
            require(jsonBody != null && jsonBody.toByteArray(StandardCharsets.UTF_8).size <= 4096)
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
        }
        try {
            if (method == "POST") {
                connection.outputStream.use { it.write(jsonBody!!.toByteArray(StandardCharsets.UTF_8)) }
            }
            val status = connection.responseCode
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
            if (interval !in listOf(30, 60, 120, 240, 1440)) return null
            val status = obj.getString("status")
            if (status !in listOf("ACTIVE", "PAUSED")) return null
            val version = obj.getInt("version")
            if (version <= 0) return null
            val head = if (obj.isNull("lastSha") || !obj.has("lastSha")) null else obj.getString("lastSha")
            if (head != null && !shaPattern.matches(head)) return null
            val checkedAt = if (obj.isNull("lastCheckedAt") || !obj.has("lastCheckedAt"))
                null else obj.getLong("lastCheckedAt")
            if (checkedAt != null && checkedAt <= 0L) return null
            CloudMonitor(id, clientDraftId, repo, interval, status, version, head, checkedAt)
            } catch (_: Exception) { null }
        }
    }

    private fun request(token: String?, method: String, body: String?): SyncResult {
        if (!validOrigin(origin)) return SyncResult.Failed(SyncFailure.NOT_CONFIGURED)
        if (!validIdTokenShape(token)) return SyncResult.Failed(SyncFailure.SIGN_IN_REQUIRED)
        return try {
            val response = transport.execute(origin, "/v1/sync/monitors", method, token!!, body)
            when (response.status) {
                200, 201 -> {
                    if (response.body.toByteArray(StandardCharsets.UTF_8).size > 16_384)
                        return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                    val data = JSONObject(response.body)
                    if (method == "POST") {
                        val monitor = parseMonitor(data.getJSONObject("monitor"))
                            ?: return SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE)
                        val created = data.getBoolean("created")
                        if ((response.status == 201) != created)
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
                401, 403 -> SyncResult.Failed(SyncFailure.UNAUTHORIZED)
                409 -> SyncResult.Failed(SyncFailure.CONFLICT)
                429 -> SyncResult.Failed(SyncFailure.RATE_LIMITED)
                else -> SyncResult.Failed(SyncFailure.UNAVAILABLE)
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
}
