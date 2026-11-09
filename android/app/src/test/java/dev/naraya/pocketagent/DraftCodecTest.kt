package dev.naraya.pocketagent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class DraftCodecTest {
    private val sampleId = UUID.randomUUID().toString()
    private val sha = "b".repeat(40)
    private fun previousRecord(repo: String = "Python/CPython") = JSONObject()
        .put("id", sampleId).put("repository", repo)
        .put("interval", 60).put("created", 1780000000000L)

    @Test fun previousOfflineDraftVersionLoadsWithoutNetworkSnapshot() {
        val drafts = DraftCodec.decode(JSONArray().put(previousRecord()).toString())
        assertEquals(1, drafts.size)
        assertEquals("python/cpython", drafts[0].repository)
        assertNull(drafts[0].lastHeadSha)
        assertNull(drafts[0].lastCheckedAt)
    }

    @Test fun liveSnapshotRoundTripRetainsShaAndTimestamp() {
        val input = MonitorDraft(sampleId, "python/cpython", 30, 1780000000000L, sha, 1780000300000L)
        val result = DraftCodec.decode(DraftCodec.encode(listOf(input)))
        assertEquals(listOf(input), result)
    }

    @Test fun brokenRecordsDoNotEraseHealthyNeighborAndDuplicatesAreDiscarded() {
        val raw = JSONArray()
            .put(JSONObject().put("id", "invalid").put("repository", "x/y"))
            .put(previousRecord())
            .put(previousRecord("PYTHON/CPYTHON"))
            .put(JSONObject().put("id", "other").put("repository", "bad/..repo"))
        val result = DraftCodec.decode(raw.toString())
        assertEquals(1, result.size)
        assertEquals(sampleId, result.single().id)
    }

    @Test fun incompleteOrMalformedObservationCannotBeShownAsVerified() {
        val onlySha = previousRecord().put("last_head", sha)
        val onlyDate = previousRecord().put("last_checked", 1780000300000L)
        val badSha = previousRecord().put("last_head", "not-a-sha").put("last_checked", 1780000300000L)
        for (obj in listOf(onlySha, onlyDate, badSha)) {
            val result = DraftCodec.decode(JSONArray().put(obj).toString())
            assertEquals(1, result.size)
            assertNull(result[0].lastHeadSha)
            assertNull(result[0].lastCheckedAt)
        }
    }

    @Test fun fullyCorruptDocumentIsFailSafe() {
        assertEquals(emptyList<MonitorDraft>(), DraftCodec.decode("{bad json"))
    }

    @Test fun atMostTwentyRecordsCanBeRestored() {
        val all = JSONArray()
        repeat(30) { idx ->
            all.put(JSONObject().put("id", UUID.randomUUID().toString())
                .put("repository", "owner/repo$idx")
                .put("interval", 30)
                .put("created", 1780000000000L))
        }
        assertEquals(20, DraftCodec.decode(all.toString()).size)
    }
}
