package dev.naraya.pocketagent

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

/**
 * Opt-in network acceptance: uses same transport as the Android UI, but executes
 * on a JVM in CI, not on a real Android device. No GitHub token or writes.
 */
class GithubHeadLiveTest {
    @Test fun readPublicGithubCommitAndConfirmWithIndependentOfficialRef() {
        assumeTrue("Live network check is separate from deterministic unit CI",
            System.getenv("NARAYA_ANDROID_LIVE_GITHUB") == "1")
        val result = GithubHeadClient().check("naraya07pedro-spec/NARAYA-Pocket-Agent")
        assertTrue("Public GitHub GET must succeed: $result", result is HeadCheckResult.Success)
        val head = (result as HeadCheckResult.Success).sha

        val link = URL("https://api.github.com/repos/naraya07pedro-spec/NARAYA-Pocket-Agent/git/ref/heads/main")
        val http = (link.openConnection() as HttpURLConnection)
        http.requestMethod = "GET"
        http.instanceFollowRedirects = false
        http.connectTimeout = 6_000
        http.readTimeout = 6_000
        http.setRequestProperty("User-Agent", "naraya-pocket-agent-android-live-jvm-ci")
        http.setRequestProperty("Accept", "application/vnd.github+json")
        http.setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        try {
            assertEquals(200, http.responseCode)
            val body = http.inputStream.bufferedReader().use { reader ->
                reader.readText().also { assertTrue(it.length < 32_768) }
            }
            val independent = JSONObject(body).getJSONObject("object").getString("sha")
            assertEquals(independent.lowercase(), head)
            println("NARAYA_ANDROID_PUBLIC_GITHUB_LIVE_READ_OK sha=$head origin=official-github")
        } finally {
            http.disconnect()
        }
    }
}
