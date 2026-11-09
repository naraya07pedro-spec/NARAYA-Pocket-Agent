package dev.naraya.pocketagent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class GithubHeadClientTest {
    private val sha = "a".repeat(40)

    @Test fun validCommitIsParsedAndPathIsPinnedToOfficialGitHub() {
        var requested = ""
        val client = GithubHeadClient(GithubTransport { url ->
            requested = url
            GithubHttpResult(200, """[{"sha":"${sha.uppercase()}"}]""")
        })
        assertEquals(HeadCheckResult.Success(sha), client.check(" Python/CPython "))
        assertEquals("https://api.github.com/repos/python/cpython/commits?per_page=1", requested)
    }

    @Test fun invalidInputCannotReachAnyNetworkTransport() {
        var requests = 0
        val client = GithubHeadClient(GithubTransport { requests++; GithubHttpResult(200) })
        assertEquals(HeadCheckResult.Failure(HeadError.INVALID_REPOSITORY),
            client.check("https://evil.example/x"))
        assertEquals(0, requests)
    }

    @Test fun statusCodesAndMalformedProviderResponsesFailClosed() {
        val cases = listOf(
            403 to HeadError.RATE_LIMITED, 429 to HeadError.RATE_LIMITED,
            404 to HeadError.NOT_FOUND, 409 to HeadError.NOT_FOUND,
            500 to HeadError.UPSTREAM_ERROR, 302 to HeadError.UPSTREAM_ERROR,
        )
        for ((status, error) in cases) {
            val result = GithubHeadClient(GithubTransport { GithubHttpResult(status, "not-json") })
                .check("python/cpython")
            assertEquals(HeadCheckResult.Failure(error), result)
        }
        for (body in listOf(
            "[]", "{}", """[{"sha":"too-short"}]""",
            """[{"sha":"$sha"},{"sha":"$sha"}]""",
            "<html>spoof</html>",
            " ".repeat(32_769),
        )) {
            val result = GithubHeadClient(GithubTransport { GithubHttpResult(200, body) })
                .check("python/cpython")
            assertEquals(HeadCheckResult.Failure(HeadError.INVALID_PROVIDER_DATA), result)
        }
    }

    @Test fun malformedProviderBytesAndNetworkFailureCannotProduceFalseSuccess() {
        val malformed = GithubHeadClient(GithubTransport { throw InvalidProviderBody() })
        assertEquals(HeadCheckResult.Failure(HeadError.INVALID_PROVIDER_DATA), malformed.check("python/cpython"))
        val network = GithubHeadClient(GithubTransport { throw java.io.IOException("timeout") })
        assertEquals(HeadCheckResult.Failure(HeadError.NETWORK_ERROR), network.check("python/cpython"))
    }

    @Test fun streamedInputIsLimitedBeforeBuffering() {
        val size = 32_769
        val tooLarge = ByteArrayInputStream(ByteArray(size) { 65 })
        var rejected = false
        try { readBounded(tooLarge, 32_768) }
        catch (_: InvalidProviderBody) { rejected = true }
        assertTrue(rejected)
        assertEquals(32_768, readBounded(ByteArrayInputStream(ByteArray(32_768)), 32_768).size)
    }
}
