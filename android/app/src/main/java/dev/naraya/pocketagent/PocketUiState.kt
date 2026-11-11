package dev.naraya.pocketagent

/**
 * UI-only presentation mapping. Never infer a live cloud state or effect
 * completion from a local draft, an approval, or a missing response.
 */
internal enum class PocketTab { HOME, TASKS, APPROVALS, MONITOR }
internal enum class PocketTaskFilter { ALL, OPEN, FINISHED }

internal object PocketUiState {
    fun title(status: String): String = when (status) {
        "QUEUED" -> "Menunggu langkah"
        "RUNNING" -> "Dalam proses manual"
        "SUCCEEDED" -> "Langkah selesai"
        "FAILED" -> "Gagal"
        "CANCELLED" -> "Dibatalkan"
        "PENDING", "AWAITING_APPROVAL" -> "Butuh keputusan"
        "APPROVED_NO_DISPATCH" -> "Disetujui · belum dikirim"
        "DENIED" -> "Ditolak"
        "EXPIRED" -> "Kedaluwarsa"
        "NOT_ATTEMPTED" -> "Belum dicoba"
        "PREPARED" -> "Disiapkan"
        "IN_FLIGHT" -> "Sedang diperiksa"
        "UNKNOWN_OUTCOME" -> "Hasil belum pasti"
        "CONFIRMED_APPLIED" -> "Tercatat di simulasi D1"
        "QUARANTINED" -> "Perlu pemeriksaan"
        else -> "Status tidak dikenal"
    }

    fun taskList(tasks: List<ReviewTask>, filter: PocketTaskFilter): List<ReviewTask> =
        when (filter) {
            PocketTaskFilter.ALL -> tasks
            PocketTaskFilter.OPEN -> tasks.filter { it.status in setOf("QUEUED", "RUNNING") }
            PocketTaskFilter.FINISHED -> tasks.filter {
                it.status in setOf("SUCCEEDED", "FAILED", "CANCELLED")
            }
        }

    fun taskNeedsApproval(task: ReviewTask, snapshot: ReviewSnapshot): Boolean =
        task.status == "SUCCEEDED" &&
            task.currentStep == 3 &&
            snapshot.leads.any { it.clientLeadId == task.leadId } &&
            snapshot.effects.none { it.taskId == task.id }

    fun decisionAllowed(approval: ReviewApproval?, effect: ReviewEffect): Boolean =
        approval != null &&
            effect.status == "AWAITING_APPROVAL" &&
            approval.status == "PENDING" &&
            approval.id == effect.approvalId &&
            approval.payloadDigest == effect.payloadDigest &&
            approval.targetDigest == effect.targetDigest &&
            approval.expiresAt > System.currentTimeMillis()

    fun pendingDecisions(snapshot: ReviewSnapshot): Int = snapshot.effects.count { effect ->
        decisionAllowed(snapshot.approvals.firstOrNull { it.id == effect.approvalId }, effect)
    }
}
