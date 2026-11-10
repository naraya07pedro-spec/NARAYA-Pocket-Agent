package dev.naraya.pocketagent

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.UUID

class CloudSyncClientTest {
    private val token = "a".repeat(45) + "." + "b".repeat(55) + "." + "c".repeat(60)
    private val origin = "https://agent.example.invalid"
    private val id = UUID.randomUUID().toString()
    private val serverId = UUID.randomUUID().toString()
    private val draft = MonitorDraft(
        id=id, repository="python/cpython", intervalMinutes=30, createdAt=1L,
        lastHeadSha="a".repeat(40), lastCheckedAt=2L,
    )

    private fun monitor(clientId: String = id, repo: String = "python/cpython", status: String = "PAUSED") =
        JSONObject().put("id", serverId).put("clientDraftId", clientId)
            .put("repository", repo).put("intervalMinutes", 30).put("status", status)
            .put("version", 1).put("lastSha", JSONObject.NULL).put("lastCheckedAt", JSONObject.NULL)
    private fun uploaded(created: Boolean = true, row: JSONObject = monitor()) =
        JSONObject().put("monitor", row).put("created", created).toString()

    @Test fun invalidOriginAndMissingTokenNeverInvokeTransport() {
        var calls = 0
        val fake = SyncTransport { _, _, _, _, _ -> calls++; SyncHttpResponse(200, uploaded()) }
        for (bad in listOf("", "http://agent.example.invalid", "https://agent.example.invalid/evil",
            "https://user@agent.example.invalid", "https://agent.example.invalid:443",
            "https://agent.example.invalid?x=1", "https://agent.example.invalid#frag")) {
            assertEquals(SyncResult.Failed(SyncFailure.NOT_CONFIGURED), CloudSyncClient(bad, fake).upload(token, draft))
        }
        val client = CloudSyncClient(origin, fake)
        assertEquals(SyncResult.Failed(SyncFailure.SIGN_IN_REQUIRED), client.upload(null, draft))
        assertEquals(SyncResult.Failed(SyncFailure.SIGN_IN_REQUIRED), client.upload("operator-key-is-not-a-jwt", draft))
        assertEquals(0, calls)
    }

    @Test fun manualUploadUsesDurableDraftIdAndNeverUploadsLocalSnapshot() {
        var calls = 0
        val client = CloudSyncClient(origin, SyncTransport { dest, path, method, bearer, body ->
            assertEquals(origin, dest)
            assertEquals("/v1/sync/monitors", path)
            assertEquals("POST", method)
            assertEquals(token, bearer)
            val req = JSONObject(body!!)
            assertEquals(setOf("clientDraftId", "repository", "intervalMinutes"), req.keys().asSequence().toSet())
            assertEquals(id, req.getString("clientDraftId"))
            assertEquals("python/cpython", req.getString("repository"))
            assertEquals(30, req.getInt("intervalMinutes"))
            assertFalse(body.contains("lastHeadSha"))
            assertFalse(body.contains("lastCheckedAt"))
            calls++
            SyncHttpResponse(if (calls == 1) 201 else 200, uploaded(calls == 1))
        })
        val first = client.upload(token, draft) as SyncResult.Uploaded
        val second = client.upload(token, draft) as SyncResult.Uploaded
        assertTrue(first.created)
        assertFalse(second.created)
        assertEquals(first.monitor.id, second.monitor.id)
        assertEquals(2, calls)
    }

    @Test fun responseMismatchAndMalformedBodiesNeverClaimUploadSuccess() {
        val bad = listOf(
            SyncHttpResponse(201, uploaded(true, monitor(clientId=UUID.randomUUID().toString()))),
            SyncHttpResponse(201, uploaded(true, monitor(repo="nodejs/node"))),
            SyncHttpResponse(200, uploaded(true)),
            SyncHttpResponse(201, uploaded(false)),
            SyncHttpResponse(201, "not-json"),
            SyncHttpResponse(201, " ".repeat(16385)),
            SyncHttpResponse(201, uploaded(true, monitor(status="INVALID"))),
        )
        for (answer in bad) {
            val result = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ -> answer }).upload(token, draft)
            assertEquals(SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE), result)
        }
    }

    @Test fun errorsAreTypedAndNeverLeakBodyOrBearer() {
        for ((status, expected) in listOf(
            401 to SyncFailure.UNAUTHORIZED, 403 to SyncFailure.UNAUTHORIZED,
            409 to SyncFailure.CONFLICT, 429 to SyncFailure.RATE_LIMITED, 503 to SyncFailure.UNAVAILABLE,
        )) {
            val body = "secret-do-not-display-$token"
            val client = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ -> SyncHttpResponse(status,body) })
            assertEquals(SyncResult.Failed(expected), client.upload(token,draft))
        }
        val client = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ -> throw IOException("raw token $token") })
        val failure = client.upload(token,draft)
        assertEquals(SyncResult.Failed(SyncFailure.NETWORK_ERROR),failure)
        assertFalse(failure.toString().contains(token))
    }

    @Test fun readOnlyReconciliationAcceptsAtMostThreeVerifiedRows() {
        val row = monitor()
        val client = CloudSyncClient(origin, SyncTransport { _, _, method, _, body ->
            assertEquals("GET",method)
            assertNull(body)
            SyncHttpResponse(200,JSONObject().put("monitors",JSONArray().put(row)).toString())
        })
        val result = client.list(token) as SyncResult.Listed
        assertEquals(1,result.monitors.size)
        assertEquals(id,result.monitors.single().clientDraftId)
        val oversized = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
            val array=JSONArray()
            repeat(4){array.put(monitor(clientId=UUID.randomUUID().toString()))}
            SyncHttpResponse(200,JSONObject().put("monitors",array).toString())
        })
        assertEquals(SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE),oversized.list(token))
    }

    @Test fun emptySessionAndLocalLogoutAreFailClosed() {
        val session=EphemeralIdToken()
        assertNull(session.read())
        assertFalse(session.replace("not-valid"))
        assertNull(session.read())
        assertTrue(session.replace(token))
        assertEquals(token,session.read())
        session.clear()
        assertNull(session.read())
    }
}
