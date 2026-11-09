package dev.naraya.pocketagent

import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/** Only ever GETs official public GitHub commit metadata; no auth headers or arbitrary URLs. */
internal fun interface GithubTransport {
    fun get(url: String): GithubHttpResult
}

internal data class GithubHttpResult(val status: Int, val body: String = "")

internal class InvalidProviderBody : IOException()

internal object PublicGithubHttpTransport : GithubTransport {
    private const val MAX_RESPONSE_BYTES = 32_768

    override fun get(url: String): GithubHttpResult {
        // Defense in depth against accidentally introducing non-GitHub destinations later.
        val parsed = URL(url)
        require(parsed.protocol == "https" && parsed.host == "api.github.com" &&
            parsed.port == -1 && parsed.userInfo == null && parsed.ref == null)
        val connection = (parsed.openConnection() as HttpURLConnection)
        connection.requestMethod = "GET"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 6_000
        connection.readTimeout = 6_000
        connection.setRequestProperty("Accept", "application/vnd.github+json")
        connection.setRequestProperty("User-Agent", "naraya-pocket-agent-android-pilot")
        connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        connection.useCaches = false
        try {
            val status = connection.responseCode
            if (status != 200) return GithubHttpResult(status)
            val declaredSize = connection.contentLengthLong
            if (declaredSize > MAX_RESPONSE_BYTES) throw InvalidProviderBody()
            val bytes = connection.inputStream.use { readBounded(it, MAX_RESPONSE_BYTES) }
            val utf8 = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            return GithubHttpResult(status, utf8.decode(ByteBuffer.wrap(bytes)).toString())
        } finally {
            connection.disconnect()
        }
    }
}

/** Bounded before buffering, regardless of a missing or dishonest Content-Length header. */
internal fun readBounded(input: InputStream, maxBytes: Int): ByteArray {
    require(maxBytes > 0)
    val out = ByteArrayOutputStream(minOf(1024, maxBytes))
    val chunk = ByteArray(1024)
    while (true) {
        val size = input.read(chunk)
        if (size == -1) return out.toByteArray()
        if (size == 0) continue
        if (out.size() + size > maxBytes) throw InvalidProviderBody()
        out.write(chunk, 0, size)
    }
}

sealed interface HeadCheckResult {
    data class Success(val sha: String) : HeadCheckResult
    data class Failure(val code: HeadError) : HeadCheckResult
}
enum class HeadError {
    INVALID_REPOSITORY, RATE_LIMITED, NOT_FOUND, UPSTREAM_ERROR,
    INVALID_PROVIDER_DATA, NETWORK_ERROR
}

internal class GithubHeadClient(
    private val transport: GithubTransport = PublicGithubHttpTransport,
) {
    /** Synchronous networking: caller MUST dispatch off the Android main thread. */
    fun check(repository: String): HeadCheckResult {
        val normalized = RepoRules.normalize(repository)
            ?: return HeadCheckResult.Failure(HeadError.INVALID_REPOSITORY)
        val (owner, name) = normalized.split("/")
        val url = "https://api.github.com/repos/$owner/$name/commits?per_page=1"
        val response = try {
            transport.get(url)
        } catch (_: InvalidProviderBody) {
            return HeadCheckResult.Failure(HeadError.INVALID_PROVIDER_DATA)
        } catch (_: IOException) {
            return HeadCheckResult.Failure(HeadError.NETWORK_ERROR)
        } catch (_: SecurityException) {
            return HeadCheckResult.Failure(HeadError.NETWORK_ERROR)
        }
        when (response.status) {
            403, 429 -> return HeadCheckResult.Failure(HeadError.RATE_LIMITED)
            404, 409 -> return HeadCheckResult.Failure(HeadError.NOT_FOUND)
            200 -> Unit
            else -> return HeadCheckResult.Failure(HeadError.UPSTREAM_ERROR)
        }
        return try {
            if (response.body.toByteArray(StandardCharsets.UTF_8).size > 32_768) {
                return HeadCheckResult.Failure(HeadError.INVALID_PROVIDER_DATA)
            }
            val entries = JSONArray(response.body)
            if (entries.length() != 1) return HeadCheckResult.Failure(HeadError.INVALID_PROVIDER_DATA)
            val sha = entries.getJSONObject(0).getString("sha")
            if (!Regex("^[0-9a-fA-F]{40}$").matches(sha)) {
                HeadCheckResult.Failure(HeadError.INVALID_PROVIDER_DATA)
            } else {
                HeadCheckResult.Success(sha.lowercase(java.util.Locale.ROOT))
            }
        } catch (_: Exception) {
            HeadCheckResult.Failure(HeadError.INVALID_PROVIDER_DATA)
        }
    }
}
