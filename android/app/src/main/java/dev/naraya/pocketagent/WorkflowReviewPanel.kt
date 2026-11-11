package dev.naraya.pocketagent

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * P2-F is rendered ONLY while Google sign-in exists in the parent composition.
 * No polling, lifecycle-triggered requests, secret persistence or background
 * execution. Every write/reconciliation is initiated by an explicit tap.
 */
private data class DemoSeed(val leadId: String, val taskId: String, val service: String)
private sealed interface ReviewConfirmation {
    data class Cancel(val task: ReviewTask) : ReviewConfirmation
    data class Decide(
        val approval: ReviewApproval, val effect: ReviewEffect, val accept: Boolean,
    ) : ReviewConfirmation
    data class Simulate(val effect: ReviewEffect) : ReviewConfirmation
}
private fun ReviewConfirmation.title(): String = when(this) {
    is ReviewConfirmation.Cancel -> "Batalkan task?"
    is ReviewConfirmation.Decide -> if (accept) "Setujui effect sintetis?" else "Tolak approval?"
    is ReviewConfirmation.Simulate -> "Jalankan simulasi D1 sekali?"
}
private fun ReviewConfirmation.details(): String = when(this) {
    is ReviewConfirmation.Cancel ->
        "Task ${task.id.take(8)}, versi ${task.version}. Pembatalan akan membatalkan " +
            "langkah yang belum selesai. Tidak ada CRM eksternal."
    is ReviewConfirmation.Decide ->
        "Task ${effect.taskId.take(8)}, efek ${effect.id.take(8)}. " +
            "Payload SHA-256 ${approval.payloadDigest.take(12)}, target " +
            "${approval.targetDigest.take(12)}. Keputusan terikat versi " +
            "${approval.version} dan tidak bisa dipakai ulang. " +
            "SETUJU hanya menjadi APPROVED_NO_DISPATCH, bukan pengiriman CRM."
    is ReviewConfirmation.Simulate ->
        "Efek ${effect.id.take(8)}. Ini hanya membuat maksimal satu catatan " +
            "sintetis di D1, BUKAN CRM, WhatsApp, email, atau tindakan eksternal. " +
            "Jika hasil tidak pasti, jangan kirim ulang; gunakan Rekonsiliasi."
}

@Composable
internal fun WorkflowReviewPanel(
    client: WorkflowReviewClient,
    readToken: () -> String?,
    onUnauthorized: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf(
        "Belum dimuat. Ketuk Muat workflow untuk membaca keadaan server."
    ) }
    var snapshot by remember { mutableStateOf<ReviewSnapshot?>(null) }
    var dispatchStates by remember { mutableStateOf<Map<String, ReviewDispatch>>(emptyMap()) }
    var confirmation by remember { mutableStateOf<ReviewConfirmation?>(null) }
    var serviceCode by remember { mutableStateOf("SIGNAGE") }
    var pendingDemo by remember { mutableStateOf<DemoSeed?>(null) }

    // This local scope is canceled on sign-out when the parent removes the
    // panel. Comparing token identity also prevents stale response rendering.
    fun refresh() {
        if (busy) return
        val token = readToken()
        if (token == null) {
            notice = "Sesi Google tidak tersedia. Login ulang."
            return
        }
        busy = true
        scope.launch {
            val outcome = withContext(Dispatchers.IO) { client.snapshot(token) }
            if (readToken() != token) {
                busy = false
                return@launch
            }
            when(outcome) {
                is ReviewResult.Ok -> {
                    snapshot = outcome.value
                    dispatchStates = dispatchStates.filterKeys { effectId ->
                        outcome.value.effects.any { it.id == effectId }
                    }
                    notice = "Data workflow dibaca dari server. Ini bukan bukti Cron/HP mati."
                }
                is ReviewResult.Failed -> {
                    notice = "Muat workflow gagal: ${outcome.code}. " +
                        "Status lama tidak boleh dianggap terbaru."
                    if (outcome.code == ReviewFailure.UNAUTHORIZED) {
                        snapshot = null
                        dispatchStates = emptyMap()
                        onUnauthorized()
                    }
                }
            }
            busy = false
        }
    }

    fun perform(
        description: String,
        execute: (String) -> ReviewResult<*>,
        onSuccess: (Any?) -> Unit = {},
    ) {
        if (busy) return
        val token = readToken()
        if (token == null) {
            notice = "Tidak ada ID token; tindakan dibatalkan."
            return
        }
        busy = true
        notice = "Meminta ${description} ke server..."
        scope.launch {
            val response = withContext(Dispatchers.IO) { execute(token) }
            if (readToken() != token) {
                busy = false
                return@launch
            }
            when(response) {
                is ReviewResult.Ok<*> -> {
                    onSuccess(response.value)
                    // No local optimistic state for versioned decisions.
                    // Re-read the actual backend before presenting a claim.
                    val latest = withContext(Dispatchers.IO) { client.snapshot(token) }
                    if (readToken() != token) {
                        busy = false
                        return@launch
                    }
                    when(latest) {
                        is ReviewResult.Ok -> {
                            snapshot = latest.value
                            dispatchStates = dispatchStates.filterKeys { effectId ->
                                latest.value.effects.any { it.id == effectId }
                            }
                            notice = "Server mengakui ${description}; daftar diverifikasi ulang. " +
                                "Tidak ada provider nyata yang dipanggil."
                        }
                        is ReviewResult.Failed -> {
                            notice = "Server mengakui permintaan, tetapi pembacaan ulang GAGAL " +
                                "(${latest.code}). Jangan menyimpulkan status final. Muat ulang."
                            snapshot = null
                            dispatchStates = emptyMap()
                            if (latest.code == ReviewFailure.UNAUTHORIZED) onUnauthorized()
                        }
                    }
                }
                is ReviewResult.Failed -> {
                    notice = "${description} belum terkonfirmasi: ${response.code}. " +
                        "Jangan retry otomatis. Muat ulang state server terlebih dahulu."
                    if (response.code == ReviewFailure.UNAUTHORIZED) {
                        snapshot = null
                        dispatchStates = emptyMap()
                        onUnauthorized()
                    }
                }
            }
            busy = false
        }
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Workflow business · HUMAN REVIEW", style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold)
            Text(
                "Hanya data lead sintetis dan simulasi D1. Task, approval dan hasil efek " +
                    "berasal dari Worker yang dikonfigurasi. Tidak ada CRM nyata, " +
                    "pesan keluar, AI otonom, atau bukti HP mati.",
                style = MaterialTheme.typography.bodySmall,
            )
            Button(enabled = !busy, onClick = { refresh() }) {
                Text(if (busy) "Memeriksa..." else "Muat workflow dari server")
            }
            Text(notice, style = MaterialTheme.typography.bodySmall)
            HorizontalDivider()
            Text("1 · Buat workflow uji", style = MaterialTheme.typography.titleSmall)
            Text("Memakai UUID sintetis, kategori jasa, dan deadline 30 hari. Tidak " +
                "menyimpan nama, nomor HP, email, atau chat pelanggan.",
                style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (option in listOf("SIGNAGE","INTERIOR","EXHIBITION")) {
                    if (serviceCode == option) Button(
                        enabled = !busy && pendingDemo == null,
                        onClick = { serviceCode = option },
                    ) { Text(option.take(4)) }
                    else OutlinedButton(
                        enabled = !busy && pendingDemo == null,
                        onClick = { serviceCode = option },
                    ) { Text(option.take(4)) }
                }
            }
            val frozen = pendingDemo
            if (frozen != null) {
                Text(
                    "ID uji tetap dipertahankan selama respons belum pasti: " +
                        "${frozen.leadId.take(8)}. Retry tidak membuat ID baru.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            OutlinedButton(
                enabled = !busy,
                onClick = {
                    val seed = pendingDemo ?: DemoSeed(
                        WorkflowReviewClient.newClientId(),
                        WorkflowReviewClient.newClientId(),serviceCode,
                    ).also { pendingDemo = it }
                    perform("pembuatan lead dan task sintetis",{
                        client.createDemo(it,seed.leadId,seed.taskId,seed.service)
                    }) { outcome ->
                        if (outcome is ReviewDemo) pendingDemo = null
                    }
                },
            ) { Text(if (pendingDemo==null) "Buat lead + task sintetis" else "Retry ID uji yang sama") }
            HorizontalDivider()
            Text("2 · Task persisten", style = MaterialTheme.typography.titleSmall)
            val data = snapshot
            if (data == null) {
                Text("Belum ada hasil baca server yang tervalidasi.",
                    style = MaterialTheme.typography.bodySmall)
            } else {
                if (data.tasks.isEmpty()) Text("Belum ada task server.",
                    style = MaterialTheme.typography.bodySmall)
                data.tasks.forEach { task ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "Task ${task.id.take(8)} · ${task.status} · langkah ${task.currentStep}/3",
                            fontWeight = FontWeight.Medium,
                        )
                        Text("Versi ${task.version} · Lead ${task.leadId.take(8)}",
                            style = MaterialTheme.typography.bodySmall)
                        if (task.status in setOf("QUEUED","RUNNING") && task.currentStep < 3) {
                            OutlinedButton(
                                enabled = !busy,
                                onClick = {
                                    perform("satu langkah sintetis", { client.advance(it,task) })
                                },
                            ) { Text("Jalankan 1 step manual") }
                            OutlinedButton(
                                enabled = !busy,
                                onClick = { confirmation = ReviewConfirmation.Cancel(task) },
                            ) { Text("Batalkan task") }
                        }
                        val service = data.leads.firstOrNull {
                            it.clientLeadId == task.leadId
                        }?.serviceCode
                        val existing = data.effects.any { it.taskId == task.id }
                        if (task.status == "SUCCEEDED" && !existing && service != null) {
                            OutlinedButton(
                                enabled = !busy,
                                onClick = {
                                    perform("permintaan approval terikat task",{
                                        client.requestTaskApproval(it,task,service)
                                    })
                                },
                            ) { Text("Buat approval sintetis") }
                        }
                        HorizontalDivider()
                    }
                }
            }
            Text("3 · Approval dan effect intent", style = MaterialTheme.typography.titleSmall)
            if (data != null) {
                if (data.effects.isEmpty()) Text("Belum ada effect intent yang terikat task.",
                    style = MaterialTheme.typography.bodySmall)
                data.effects.forEach { effect ->
                    val approval = data.approvals.firstOrNull {
                        it.id == effect.approvalId &&
                            it.payloadDigest == effect.payloadDigest &&
                            it.targetDigest == effect.targetDigest
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Text("Effect ${effect.id.take(8)} · ${effect.status}",
                            fontWeight = FontWeight.Medium)
                        Text(
                            "Task ${effect.taskId.take(8)} · ${effect.serviceCode} · " +
                                "SHA-256 ${effect.payloadDigest.take(12)}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        if (effect.status == "AWAITING_APPROVAL" &&
                            approval?.status == "PENDING") {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(enabled = !busy,
                                    onClick = {
                                        confirmation = ReviewConfirmation.Decide(approval,effect,true)
                                    }) { Text("Setujui") }
                                OutlinedButton(enabled = !busy,
                                    onClick = {
                                        confirmation = ReviewConfirmation.Decide(approval,effect,false)
                                    }) { Text("Tolak") }
                            }
                        } else if (effect.status == "AWAITING_APPROVAL") {
                            Text("Approval tidak tersedia, sudah expired, atau di luar halaman " +
                                "server saat ini. Tidak ada keputusan otomatis.",
                                style = MaterialTheme.typography.bodySmall)
                        }
                        if (effect.status == "APPROVED_NO_DISPATCH") {
                            val recorded = dispatchStates[effect.id]
                            OutlinedButton(enabled = !busy, onClick = {
                                val token = readToken()
                                if (token == null) {
                                    notice = "Login Google ulang untuk membaca hasil."
                                } else {
                                    busy = true
                                    scope.launch {
                                        val result = withContext(Dispatchers.IO) {
                                            client.getDispatch(token,effect.id)
                                        }
                                        if (readToken() == token) {
                                            when(result) {
                                                is ReviewResult.Ok -> {
                                                    dispatchStates = dispatchStates + (effect.id to result.value)
                                                    notice = "Status D1 terbaru dibaca. Ini bukan efek CRM eksternal."
                                                }
                                                is ReviewResult.Failed -> {
                                                    notice = "Status efek tidak terkonfirmasi: ${result.code}"
                                                    if(result.code==ReviewFailure.UNAUTHORIZED) onUnauthorized()
                                                }
                                            }
                                        }
                                        busy = false
                                    }
                                }
                            }) { Text("Baca status simulasi D1") }
                            if (recorded != null) {
                                Text(
                                    "Simulasi: ${recorded.state} · upaya ${recorded.attemptCount}/1 · " +
                                        "readback ${recorded.readback ?: "belum ada"}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                if (recorded.state == "NOT_ATTEMPTED") {
                                    Button(
                                        enabled = !busy,
                                        onClick = { confirmation = ReviewConfirmation.Simulate(effect) },
                                    ) { Text("Simulasikan 1 efek D1") }
                                }
                                if (recorded.state in setOf("IN_FLIGHT","UNKNOWN_OUTCOME")) {
                                    OutlinedButton(enabled = !busy, onClick = {
                                        perform("rekonsiliasi read-only", {
                                            client.reconcile(it,effect)
                                        }) { outcome ->
                                            if(outcome is ReviewDispatch)
                                                dispatchStates = dispatchStates + (effect.id to outcome)
                                        }
                                    }) { Text("Rekonsiliasi tanpa retry") }
                                }
                                Text("safeToRetry = false. Tidak ada tombol eksekusi ulang.",
                                    style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        HorizontalDivider()
                    }
                }
            }
            Text("Hanya status server terakhir. Jika permintaan gagal atau timeout, " +
                "tidak ada keberhasilan yang diasumsikan. Refresh sebelum mengambil keputusan.",
                style = MaterialTheme.typography.bodySmall)
        }
    }

    val current = confirmation
    if (current != null) {
        AlertDialog(
            onDismissRequest = { if (!busy) confirmation = null },
            title = { Text(current.title()) },
            text = { Text(current.details()) },
            confirmButton = {
                Button(enabled = !busy, onClick = {
                    confirmation = null
                    when(current) {
                        is ReviewConfirmation.Cancel ->
                            perform("pembatalan task", { client.cancel(it,current.task) })
                        is ReviewConfirmation.Decide ->
                            perform(if(current.accept)"persetujuan satu-kali" else "penolakan",{
                                client.decide(it,current.approval,current.effect,current.accept)
                            })
                        is ReviewConfirmation.Simulate ->
                            perform("simulasi satu efek D1",{
                                client.sandboxAttempt(it,current.effect)
                            }) { outcome ->
                                if(outcome is ReviewDispatch)
                                    dispatchStates = dispatchStates + (current.effect.id to outcome)
                            }
                    }
                }) { Text("Konfirmasi") }
            },
            dismissButton = {
                OutlinedButton(enabled = !busy, onClick = { confirmation = null }) {
                    Text("Kembali")
                }
            },
        )
    }
}
