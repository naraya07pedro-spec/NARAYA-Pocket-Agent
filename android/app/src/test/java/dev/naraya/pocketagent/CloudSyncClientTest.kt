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
            .put("schedulerEligible", status == "ACTIVE").put("scheduled", false)
    private fun uploaded(created: Boolean = true, row: JSONObject = monitor()) =
        JSONObject().put("monitor", row).put("created", created).toString()

    @Test fun standardDebugBuildIsFailClosedWithoutOAuthOrWorkerConfig() {
        assertEquals("", BuildConfig.GOOGLE_WEB_CLIENT_ID)
        assertEquals("", BuildConfig.CLOUD_API_ORIGIN)
        assertFalse(CloudSyncClient.validOrigin(BuildConfig.CLOUD_API_ORIGIN))
    }

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
            SyncHttpResponse(201, uploaded(true, monitor(status="ACTIVE"))),
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

    @Test fun transportOnlyAllowsExplicitScopedGetPostAndPatchRoutes() {
        assertTrue(CloudSyncClient.allowedRoute("/v1/sync/monitors", "GET"))
        assertTrue(CloudSyncClient.allowedRoute("/v1/sync/monitors", "POST"))
        assertTrue(CloudSyncClient.allowedRoute("/v1/sync/monitors/$serverId", "PATCH"))
        assertTrue(CloudSyncClient.allowedRoute("/v1/sync/observations?monitorId=$serverId", "GET"))
        for ((path, method) in listOf(
            "/v1/sync/monitors" to "PATCH",
            "/v1/sync/monitors/$serverId" to "POST",
            "/v1/sync/observations?monitorId=$serverId" to "PATCH",
            "/v1/sync/observations?monitorId=$serverId&owner=other" to "GET",
            "/v1/monitors/$serverId" to "PATCH",
            "https://attacker.invalid/x" to "GET",
            "/v1/sync/monitors/../../admin" to "PATCH",
            "/v1/sync/observations?monitorId=bad" to "GET",
        )) assertFalse("$method $path should be rejected", CloudSyncClient.allowedRoute(path, method))
    }

    @Test fun pauseAndActivateMustUseVersionAndValidateServerAck() {
        var calls = 0
        val current = CloudMonitor(serverId, id, "python/cpython", 30, "ACTIVE", 7, null, null, true, false)
        val client = CloudSyncClient(origin, SyncTransport { dest, path, method, bearer, json ->
            assertEquals(origin, dest)
            assertEquals("/v1/sync/monitors/$serverId", path)
            assertEquals("PATCH", method)
            assertEquals(token, bearer)
            assertEquals(setOf("expectedVersion", "status"), JSONObject(json!!).keys().asSequence().toSet())
            assertEquals(7, JSONObject(json).getInt("expectedVersion"))
            assertEquals("PAUSED", JSONObject(json).getString("status"))
            calls++
            SyncHttpResponse(200, JSONObject().put("id", serverId).put("status", "PAUSED")
                .put("version", 8).put("schedulerEligible", false).toString())
        })
        val changed = client.changeStatus(token, current, "PAUSED") as SyncResult.StatusChanged
        assertEquals(8, changed.version)
        assertEquals(false, changed.schedulerEligible)
        assertEquals(1, calls)
        assertEquals(SyncResult.Failed(SyncFailure.CONFLICT), client.changeStatus(token, current, "ACTIVE"))
        assertEquals(SyncResult.Failed(SyncFailure.CONFLICT), client.changeStatus(token, current, "INVALID"))
        assertEquals(1, calls)
    }

    @Test fun activeAckConflictsAndForgedOrStaleRepliesNeverSetCloudStatus() {
        val current = CloudMonitor(serverId, id, "python/cpython", 30, "PAUSED", 1, null, null, false, false)
        val bodies = listOf(
            SyncHttpResponse(200, JSONObject().put("id", UUID.randomUUID().toString())
                .put("status", "ACTIVE").put("version", 2).put("schedulerEligible", true).toString()),
            SyncHttpResponse(200, JSONObject().put("id", serverId)
                .put("status", "ACTIVE").put("version", 99).put("schedulerEligible", true).toString()),
            SyncHttpResponse(200, JSONObject().put("id", serverId)
                .put("status", "ACTIVE").put("version", 2).put("schedulerEligible", false).toString()),
            SyncHttpResponse(200, JSONObject().put("id", serverId)
                .put("status", "PAUSED").put("version", 2).put("schedulerEligible", false).toString()),
            SyncHttpResponse(201, JSONObject().put("id", serverId)
                .put("status", "ACTIVE").put("version", 2).put("schedulerEligible", true).toString()),
            SyncHttpResponse(200, "not-json"),
        )
        for (body in bodies) {
            val result = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ -> body })
                .changeStatus(token, current, "ACTIVE")
            assertEquals(SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE), result)
        }
        for ((http, expected) in listOf(
            401 to SyncFailure.UNAUTHORIZED,
            404 to SyncFailure.NOT_FOUND,
            409 to SyncFailure.CONFLICT,
            429 to SyncFailure.RATE_LIMITED,
            503 to SyncFailure.UNAVAILABLE,
        )) {
            val result = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
                SyncHttpResponse(http, "ignored-bearer-$token")
            }).changeStatus(token, current, "ACTIVE")
            assertEquals(SyncResult.Failed(expected), result)
            assertFalse(result.toString().contains(token))
        }
    }

    private fun observation(
        monitorId: String = serverId,
        kind: String = "BASELINE",
        previous: String? = null,
        sha: String = "b".repeat(40),
        whenSeen: Long = 1800000000000L,
        idValue: String = UUID.randomUUID().toString(),
    ) = JSONObject().put("id", idValue).put("monitor_id", monitorId)
        .put("event_type", kind).put("previous_sha", previous ?: JSONObject.NULL)
        .put("head_sha", sha).put("observed_at", whenSeen)

    @Test fun observationReadIsBoundToOneMonitorAndServerProvenance() {
        val rows = JSONArray()
            .put(observation(kind="CHANGE", previous="a".repeat(40), whenSeen=1800000000000L))
            .put(observation(kind="BASELINE", whenSeen=1799999990000L))
        var calls = 0
        val client = CloudSyncClient(origin, SyncTransport { _, path, method, bearer, body ->
            assertEquals("GET", method)
            assertEquals("/v1/sync/observations?monitorId=$serverId", path)
            assertEquals(token, bearer)
            assertNull(body)
            calls++
            SyncHttpResponse(200, JSONObject().put("observations", rows).toString())
        })
        val result = client.observations(token, serverId) as SyncResult.Observed
        assertEquals(serverId, result.monitorId)
        assertEquals(2, result.observations.size)
        assertEquals("CHANGE", result.observations[0].type)
        assertEquals("b".repeat(40), result.observations[0].headSha)
        assertEquals(1, calls)
        assertEquals(SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE),
            client.observations(token, "not-uuid"))
        assertEquals(1, calls)
    }

    @Test fun observationSchemaRejectsCrossOwnerEventsInvalidShasAndExcessData() {
        val invalid = listOf(
            JSONArray().put(observation(monitorId=UUID.randomUUID().toString())),
            JSONArray().put(observation(kind="FAKE")),
            JSONArray().put(observation(sha="injected")),
            JSONArray().put(observation(whenSeen=-1L)),
            JSONArray().put(observation(kind="CHANGE")),
            JSONArray().put(observation(kind="BASELINE", previous="a".repeat(40))),
            JSONArray().put(observation()).put(observation(idValue=UUID.randomUUID().toString(),
                whenSeen=1900000000000L)),
            JSONArray().also { list -> repeat(51) { list.put(observation()) } },
        )
        for (rows in invalid) {
            val answer = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
                SyncHttpResponse(200, JSONObject().put("observations", rows).toString())
            }).observations(token, serverId)
            assertEquals(SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE), answer)
        }
        val foreign = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
            SyncHttpResponse(404, "no owner data")
        })
        assertEquals(SyncResult.Failed(SyncFailure.NOT_FOUND), foreign.observations(token,serverId))
    }

    @Test fun conflict409BodyIsStrictlyMappedToKnownSafeCodes() {
        val paused = CloudMonitor(serverId, id, "python/cpython", 30, "PAUSED", 1, null, null, false, false)
        for ((raw, code) in listOf(
            "scheduler_disabled" to SyncFailure.SCHEDULER_DISABLED,
            "stale_version" to SyncFailure.STALE_VERSION,
            "active_monitor_limit" to SyncFailure.ACTIVE_LIMIT,
            "surprise-upstream-detail" to SyncFailure.CONFLICT,
        )) {
            val response = SyncHttpResponse(409, JSONObject().put("error", raw)
                .put("debug", "token=$token").toString())
            val outcome = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ -> response })
                .changeStatus(token, paused, "ACTIVE")
            assertEquals(SyncResult.Failed(code), outcome)
            assertFalse(outcome.toString().contains(token))
            assertFalse(outcome.toString().contains("debug"))
        }
        val invalid = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
            SyncHttpResponse(409, "body including hidden token $token")
        })
        assertEquals(SyncResult.Failed(SyncFailure.CONFLICT),invalid.changeStatus(token, paused, "ACTIVE"))
    }

    @Test fun schedulerEligibilityAndExecutionFlagsAreRequiredAndTypeStrict() {
        val invalid = listOf(
            monitor().apply { remove("schedulerEligible") },
            monitor().apply { remove("scheduled") },
            monitor().put("schedulerEligible", "false"),
            monitor().put("scheduled", "false"),
            monitor().put("schedulerEligible", JSONObject.NULL),
            monitor().put("scheduled", JSONObject.NULL),
            monitor(status="PAUSED").put("schedulerEligible", true),
            monitor(status="PAUSED").put("scheduled", true),
            monitor(status="ACTIVE").put("schedulerEligible", false).put("scheduled", true),
        )
        for (row in invalid) {
            val answer = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
                SyncHttpResponse(200, JSONObject().put("monitors", JSONArray().put(row)).toString())
            }).list(token)
            assertEquals("must reject unproven scheduler flags: $row",
                SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE), answer)
        }
    }

    @Test fun persistedActiveDoesNotImplyCronEligibilityOrProvenRemoteExecution() {
        val off = monitor(status="ACTIVE").put("schedulerEligible", false)
        val eligible = monitor(status="ACTIVE").put("schedulerEligible", true)
        val claimed = monitor(status="ACTIVE").put("schedulerEligible", true).put("scheduled", true)
        fun read(row: JSONObject): CloudMonitor {
            val answer = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
                SyncHttpResponse(200,JSONObject().put("monitors",JSONArray().put(row)).toString())
            }).list(token) as SyncResult.Listed
            return answer.monitors.single()
        }
        val stopped = read(off)
        assertEquals("ACTIVE", stopped.status)
        assertFalse(stopped.schedulerEligible)
        assertFalse(stopped.scheduled)
        assertTrue(stopped.executionSummary().contains("eligibility is OFF"))
        assertTrue(stopped.executionSummary().contains("last server snapshot"))
        val configured = read(eligible)
        assertTrue(configured.schedulerEligible)
        assertFalse(configured.scheduled)
        assertTrue(configured.executionSummary().contains("NOT verified"))
        val serverClaim = read(claimed)
        assertTrue(serverClaim.scheduled)
        assertTrue(serverClaim.executionSummary().contains("NOT independently verified"))
        val paused = read(monitor())
        assertEquals("PAUSED", paused.status)
        assertFalse(paused.schedulerEligible)
        assertTrue(paused.executionSummary().contains("No execution is authorized"))
    }

    @Test fun clientAcceptsServerValid15MinuteIntervalsWithoutBroadeningLocalDraftCreation() {
        val fortyFive = monitor().put("intervalMinutes", 45)
        val listed = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
            SyncHttpResponse(200,JSONObject().put("monitors",JSONArray().put(fortyFive)).toString())
        }).list(token) as SyncResult.Listed
        assertEquals(45,listed.monitors.single().intervalMinutes)
        for (bad in listOf(1,15,31,1455,-15)) {
            val row = monitor().put("intervalMinutes",bad)
            val reply = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
                SyncHttpResponse(200,JSONObject().put("monitors",JSONArray().put(row)).toString())
            }).list(token)
            assertEquals(SyncResult.Failed(SyncFailure.INVALID_SERVER_RESPONSE),reply)
        }
    }

    @Test fun schedulerD1Unavailable503IsActionableAndNeverEchoesUpstreamSecrets() {
        val paused = CloudMonitor(serverId, id, "python/cpython", 30, "PAUSED", 1, null, null, false, false)
        val response = SyncHttpResponse(503,JSONObject()
            .put("error","scheduler_storage_unavailable")
            .put("debug","private-bearer-$token").toString())
        val typed = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ -> response })
            .changeStatus(token,paused,"ACTIVE")
        assertEquals(SyncResult.Failed(SyncFailure.SCHEDULER_STORAGE_UNAVAILABLE),typed)
        assertFalse(typed.toString().contains(token))
        for (body in listOf("not-json", "{\"error\":\"other\"}",
            "{\"error\":\"scheduler_storage_unavailable\",\"debug\":\"$token\"}".repeat(1000))) {
            val actual = CloudSyncClient(origin, SyncTransport { _, _, _, _, _ ->
                SyncHttpResponse(503,body)
            }).changeStatus(token,paused,"ACTIVE")
            // An intentionally oversized fake transport body is not a trusted error.
            // The real transport refuses reading error bodies > 2 KiB.
            if (body.length < 2048)
                assertEquals(SyncResult.Failed(SyncFailure.UNAVAILABLE),actual)
            else assertFalse(actual.toString().contains(token))
        }
    }

    @Test fun versionedStatusMappingCannotLeaveStaleEligibleFlagOrInventScheduledCron() {
        val stored=CloudMonitor(serverId,id,"python/cpython",30,"ACTIVE",7,null,null,true,false)
        val paused=SyncResult.StatusChanged(serverId,"PAUSED",8,false)
        val result=stored.withConfirmedStatus(paused)!!
        assertEquals("PAUSED",result.status)
        assertFalse(result.schedulerEligible)
        assertFalse(result.scheduled)
        assertEquals(8,result.version)
        assertEquals(7,stored.version)
        assertTrue(stored.schedulerEligible)
        assertNull(stored.withConfirmedStatus(paused.copy(version=9)))
        assertNull(stored.withConfirmedStatus(paused.copy(monitorId=UUID.randomUUID().toString())))
        assertNull(stored.withConfirmedStatus(paused.copy(schedulerEligible=true)))
        val resumed=result.withConfirmedStatus(SyncResult.StatusChanged(serverId,"ACTIVE",9,true))!!
        assertTrue(resumed.schedulerEligible)
        assertFalse(resumed.scheduled)
        assertTrue(resumed.executionSummary().contains("NOT verified"))
    }

}
