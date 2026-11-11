package dev.naraya.pocketagent

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class PocketUiStateTest {
    private val taskId=UUID.randomUUID().toString()
    private val leadId=UUID.randomUUID().toString()
    private val approvalId=UUID.randomUUID().toString()
    private val effectId=UUID.randomUUID().toString()
    private val payload="a".repeat(64)
    private val target="b".repeat(64)

    private fun task(status:String="SUCCEEDED",steps:Int=3)=
        ReviewTask(taskId,leadId,status,5,steps)
    private fun effect(status:String="AWAITING_APPROVAL")=
        ReviewEffect(effectId,taskId,approvalId,leadId,"SIGNAGE",status,payload,target)
    private fun approval(status:String="PENDING")=
        ReviewApproval(approvalId,status,1,payload,target,System.currentTimeMillis()+600000)
    private fun snapshot(
        tasks:List<ReviewTask> = listOf(task()),
        approvals:List<ReviewApproval> = emptyList(),
        effects:List<ReviewEffect> = emptyList(),
        leads:List<ReviewLead> = listOf(ReviewLead(leadId,"SIGNAGE")),
    )=ReviewSnapshot(leads,tasks,approvals,effects)

    @Test fun labelsNeverClaimExternalCRMSendOrVerifiedCloud(){
        assertEquals("Dalam proses manual",PocketUiState.title("RUNNING"))
        assertEquals("Disetujui · belum dikirim",
            PocketUiState.title("APPROVED_NO_DISPATCH"))
        assertEquals("Tercatat di simulasi D1",
            PocketUiState.title("CONFIRMED_APPLIED"))
        assertEquals("Hasil belum pasti",PocketUiState.title("UNKNOWN_OUTCOME"))
        assertEquals("Status tidak dikenal",PocketUiState.title("UNKNOWN_STATUS"))
        assertFalse(PocketUiState.title("CONFIRMED_APPLIED").contains("CRM"))
        assertFalse(PocketUiState.title("CONFIRMED_APPLIED").contains("terkirim"))
    }

    @Test fun filtersUseExactServerTaskStatusesNoFabricatedCounts(){
        val tasks=listOf(
            task("QUEUED",0),task("RUNNING",1),task("SUCCEEDED",3),
            task("FAILED",2),task("CANCELLED",0),
        )
        assertEquals(5,PocketUiState.taskList(tasks,PocketTaskFilter.ALL).size)
        assertEquals(listOf("QUEUED","RUNNING"),
            PocketUiState.taskList(tasks,PocketTaskFilter.OPEN).map { it.status })
        assertEquals(listOf("SUCCEEDED","FAILED","CANCELLED"),
            PocketUiState.taskList(tasks,PocketTaskFilter.FINISHED).map { it.status })
        assertTrue(PocketUiState.taskList(emptyList(),PocketTaskFilter.ALL).isEmpty())
    }

    @Test fun approvalButtonRequiresCompletedServerTaskMatchingStoredLeadAndNoExistingEffect(){
        val ready=task()
        assertTrue(PocketUiState.taskNeedsApproval(ready,snapshot()))
        assertFalse(PocketUiState.taskNeedsApproval(task("RUNNING",2),snapshot()))
        assertFalse(PocketUiState.taskNeedsApproval(task("SUCCEEDED",2),snapshot()))
        assertFalse(PocketUiState.taskNeedsApproval(ready,snapshot(leads=emptyList())))
        assertFalse(PocketUiState.taskNeedsApproval(ready,snapshot(effects=listOf(effect()))))
        assertFalse(PocketUiState.taskNeedsApproval(ready,
            snapshot(leads=listOf(ReviewLead(UUID.randomUUID().toString(),"SIGNAGE")))))
    }

    @Test fun reviewButtonCannotBeShownForExpiredDeniedForgedOrUnboundIntents(){
        val effect=effect()
        val valid=approval()
        assertTrue(PocketUiState.decisionAllowed(valid,effect))
        assertFalse(PocketUiState.decisionAllowed(null,effect))
        assertFalse(PocketUiState.decisionAllowed(valid.copy(status="DENIED"),effect))
        assertFalse(PocketUiState.decisionAllowed(valid.copy(status="EXPIRED"),effect))
        assertFalse(PocketUiState.decisionAllowed(valid.copy(
            expiresAt=System.currentTimeMillis()-1000),effect))
        assertFalse(PocketUiState.decisionAllowed(valid.copy(
            payloadDigest="c".repeat(64)),effect))
        assertFalse(PocketUiState.decisionAllowed(valid.copy(
            targetDigest="d".repeat(64)),effect))
        assertFalse(PocketUiState.decisionAllowed(valid.copy(
            id=UUID.randomUUID().toString()),effect))
        assertFalse(PocketUiState.decisionAllowed(valid,effect("APPROVED_NO_DISPATCH")))
    }

    @Test fun pendingCountComesOnlyFromBoundUnexpiredOwnerSnapshot(){
        val valid=effect()
        assertEquals(0,PocketUiState.pendingDecisions(snapshot()))
        assertEquals(1,PocketUiState.pendingDecisions(
            snapshot(approvals=listOf(approval()),effects=listOf(valid))))
        assertEquals(0,PocketUiState.pendingDecisions(
            snapshot(approvals=listOf(approval("DENIED")),effects=listOf(valid))))
        assertEquals(0,PocketUiState.pendingDecisions(
            snapshot(approvals=listOf(approval()),effects=listOf(effect("DENIED")))))
    }
}
