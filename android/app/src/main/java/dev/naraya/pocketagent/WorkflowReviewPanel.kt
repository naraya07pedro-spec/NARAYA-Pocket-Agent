package dev.naraya.pocketagent

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.weight
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.ui.Alignment
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
    mode: PocketTab,
    modifier: Modifier = Modifier,
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
                    snapshot = null
                    dispatchStates = emptyMap()
                    notice = "Muat workflow gagal: ${outcome.code}. " +
                        "Status lama tidak boleh dianggap terbaru."
                    if (outcome.code == ReviewFailure.UNAUTHORIZED) onUnauthorized()
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

    val data = snapshot
    var selectedFilter by remember { mutableStateOf(PocketTaskFilter.ALL) }
    var expandedEffect by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        PocketEyebrow(if (mode == PocketTab.TASKS) "WORKFLOW  /  02" else "HUMAN REVIEW  /  03")
        Text(
            if (mode == PocketTab.TASKS) "Pekerjaan." else "Persetujuan.",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
        PocketMuted(
            if (mode == PocketTab.TASKS)
                "Tiga langkah verifikasi yang dijalankan manual. Semua status berasal dari D1."
            else "Setiap keputusan terikat ke task, target, dan versi. Persetujuan tidak mengirim CRM."
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PocketTag("SINTETIS")
            PocketTag("TANPA PENGIRIMAN")
        }
        OutlinedButton(enabled = !busy, onClick = { refresh() }) {
            Text(if (busy) "Memeriksa server..." else "Muat ulang dari server")
        }
        PocketPanel {
            PocketEyebrow("STATUS PEMBACAAN")
            Text(notice, style = MaterialTheme.typography.bodySmall, color = PocketInk.muted)
        }

        if (mode == PocketTab.TASKS) {
            PocketEyebrow("BUAT PENGUJIAN")
            PocketPanel {
                Text("Workflow uji baru", style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold)
                PocketMuted(
                    "UUID dan kategori jasa sintetis. Tidak ada nama, nomor telepon, " +
                        "atau data pelanggan nyata."
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (option in listOf("SIGNAGE","INTERIOR","EXHIBITION")) {
                        FilterChip(
                            selected = serviceCode == option,
                            enabled = !busy && pendingDemo == null,
                            onClick = { serviceCode = option },
                            label = { Text(when(option) {
                                "SIGNAGE" -> "Signage"
                                "INTERIOR" -> "Interior"
                                else -> "Pameran"
                            }) },
                        )
                    }
                }
                val frozen = pendingDemo
                if (frozen != null) {
                    PocketMuted(
                        "Permintaan sebelumnya belum pasti. ID ${frozen.leadId.take(8)} " +
                            "dipertahankan agar tidak membuat duplikat."
                    )
                }
                Button(
                    enabled = !busy,
                    onClick = {
                        val seed = pendingDemo ?: DemoSeed(
                            WorkflowReviewClient.newClientId(),
                            WorkflowReviewClient.newClientId(),serviceCode,
                        ).also { pendingDemo = it }
                        perform("pembuatan lead dan task sintetis", {
                            client.createDemo(it,seed.leadId,seed.taskId,seed.service)
                        }) { result ->
                            if (result is ReviewDemo) pendingDemo = null
                        }
                    },
                ) {
                    Text(if (pendingDemo == null) "Buat task uji" else "Gunakan ID uji yang sama")
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                PocketEyebrow("DAFTAR TUGAS")
                if (data != null) PocketTag("${data.tasks.size} tercatat")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((filter,label) in listOf(
                    PocketTaskFilter.ALL to "Semua",
                    PocketTaskFilter.OPEN to "Aktif",
                    PocketTaskFilter.FINISHED to "Riwayat",
                )) {
                    FilterChip(
                        selected = selectedFilter == filter,
                        onClick = { selectedFilter = filter },
                        label = { Text(label) },
                    )
                }
            }
            if (data == null) {
                PocketMuted("Ketuk Muat ulang dari server untuk melihat task milik akunmu.")
            } else {
                val visible = PocketUiState.taskList(data.tasks,selectedFilter)
                if (visible.isEmpty()) PocketPanel {
                    Text("Tidak ada tugas pada filter ini.",
                        style = MaterialTheme.typography.titleSmall)
                    PocketMuted("Ini berarti halaman server tidak mengembalikan task " +
                        "untuk filter tersebut, bukan bukti agent sudah selesai bekerja.")
                }
                visible.forEach { task ->
                    PocketPanel {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column(modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("Validasi lead sintetis",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold)
                                PocketMuted("Task ${task.id.take(8)}  ·  versi ${task.version}")
                            }
                            PocketTag(
                                PocketUiState.title(task.status),
                                caution = task.status in setOf("FAILED","CANCELLED"),
                            )
                        }
                        LinearProgressIndicator(
                            progress = { task.currentStep / 3f },
                            modifier = Modifier.fillMaxWidth(),
                            color = PocketInk.accent,
                            trackColor = PocketInk.border,
                        )
                        PocketMuted("Langkah tervalidasi: ${task.currentStep} dari 3. " +
                            "Tidak ada langkah otomatis.")
                        if (task.status in setOf("QUEUED","RUNNING") && task.currentStep < 3) {
                            Button(
                                enabled = !busy,
                                onClick = {
                                    perform("satu langkah sintetis", { client.advance(it,task) })
                                },
                            ) { Text("Jalankan 1 langkah") }
                            OutlinedButton(
                                enabled = !busy,
                                onClick = { confirmation = ReviewConfirmation.Cancel(task) },
                            ) { Text("Batalkan task") }
                        }
                        val service = data.leads.firstOrNull {
                            it.clientLeadId == task.leadId
                        }?.serviceCode
                        if (PocketUiState.taskNeedsApproval(task,data) && service != null) {
                            Button(
                                enabled = !busy,
                                onClick = {
                                    perform("permintaan approval terikat task", {
                                        client.requestTaskApproval(it,task,service)
                                    })
                                },
                            ) { Text("Ajukan persetujuan") }
                        }
                    }
                }
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                PocketEyebrow("KOTAK KEPUTUSAN")
                if (data != null) PocketTag(
                    "${PocketUiState.pendingDecisions(data)} menunggu",
                    caution = PocketUiState.pendingDecisions(data)>0,
                )
            }
            if (data == null) {
                PocketMuted("Belum ada approval terverifikasi dari server.")
            } else if (data.effects.isEmpty()) {
                PocketPanel {
                    Text("Belum ada tindakan untuk ditinjau.",
                        style = MaterialTheme.typography.titleMedium)
                    PocketMuted("Approval hanya dibuat dari task sintetis yang telah " +
                        "menyelesaikan ketiga langkahnya. Tidak ada contoh palsu.")
                }
            } else {
                val sorted = data.effects.sortedWith(
                    compareBy<ReviewEffect> { effect ->
                        val approval = data.approvals.firstOrNull { it.id == effect.approvalId }
                        if (PocketUiState.decisionAllowed(approval,effect)) 0 else 1
                    }.thenBy { it.id },
                )
                sorted.forEach { effect ->
                    val approval = data.approvals.firstOrNull {
                        it.id == effect.approvalId &&
                            it.payloadDigest == effect.payloadDigest &&
                            it.targetDigest == effect.targetDigest
                    }
                    val eligible = PocketUiState.decisionAllowed(approval,effect)
                    PocketPanel {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            PocketEyebrow(if (eligible) "PERLU KEPUTUSAN" else "CATATAN EFFECT")
                            PocketTag(PocketUiState.title(effect.status),
                                caution = eligible || effect.status=="DENIED")
                        }
                        Text("Catat lead di CRM sintetis",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold)
                        PocketMuted(
                            "Kategori: ${effect.serviceCode}  ·  Task ${effect.taskId.take(8)}\n" +
                                "Target: sandbox D1, bukan CRM eksternal."
                        )
                        if (eligible && approval != null) {
                            PocketMuted("Diajukan untuk keputusan sekali pakai. " +
                                "Menekan Setujui hanya mengubah izin menjadi APPROVED_NO_DISPATCH.")
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                OutlinedButton(
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f),
                                    onClick = {
                                        confirmation = ReviewConfirmation.Decide(approval,effect,false)
                                    },
                                ) { Text("Tolak") }
                                Button(
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f),
                                    onClick = {
                                        confirmation = ReviewConfirmation.Decide(approval,effect,true)
                                    },
                                ) { Text("Setujui") }
                            }
                        } else if (effect.status == "AWAITING_APPROVAL") {
                            PocketMuted("Keputusan tidak tersedia, kedaluwarsa, atau bukan " +
                                "bagian dari halaman approval terverifikasi. Muat ulang.")
                        }
                        if (effect.status == "APPROVED_NO_DISPATCH") {
                            PocketMuted("Izin diberikan. Belum ada tindakan CRM atau pesan keluar.")
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
                                            when (result) {
                                                is ReviewResult.Ok -> {
                                                    dispatchStates = dispatchStates + (effect.id to result.value)
                                                    notice = "Status D1 dibaca. Bukan hasil CRM eksternal."
                                                }
                                                is ReviewResult.Failed -> {
                                                    dispatchStates = dispatchStates - effect.id
                                                    notice = "Status simulasi tidak terkonfirmasi: ${result.code}"
                                                    if(result.code==ReviewFailure.UNAUTHORIZED) onUnauthorized()
                                                }
                                            }
                                        }
                                        busy = false
                                    }
                                }
                            }) { Text("Periksa hasil simulasi") }
                            val recorded = dispatchStates[effect.id]
                            if (recorded != null) {
                                PocketTag(PocketUiState.title(recorded.state),
                                    caution=recorded.state in setOf("UNKNOWN_OUTCOME","QUARANTINED"))
                                PocketMuted("Upaya provider sintetis: ${recorded.attemptCount}/1  ·  " +
                                    "readback: ${recorded.readback ?: "belum diperiksa"}")
                                if (recorded.state == "NOT_ATTEMPTED") {
                                    Button(
                                        enabled = !busy,
                                        onClick = {
                                            confirmation = ReviewConfirmation.Simulate(effect)
                                        },
                                    ) { Text("Jalankan 1 simulasi D1") }
                                }
                                if (recorded.state in setOf("IN_FLIGHT","UNKNOWN_OUTCOME")) {
                                    OutlinedButton(enabled = !busy, onClick = {
                                        perform("rekonsiliasi read-only", {
                                            client.reconcile(it,effect)
                                        }) { result ->
                                            if(result is ReviewDispatch) {
                                                dispatchStates = dispatchStates +
                                                    (effect.id to result)
                                            }
                                        }
                                    }) { Text("Rekonsiliasi tanpa retry") }
                                }
                                PocketMuted("Tidak ada retry otomatis. Hasil tidak pasti " +
                                    "tidak memberi izin untuk mengirim ulang.")
                            }
                        }
                        OutlinedButton(
                            onClick = {
                                expandedEffect = if (expandedEffect==effect.id) null else effect.id
                            },
                        ) {
                            Text(if (expandedEffect==effect.id) "Tutup detail teknis"
                                else "Detail teknis")
                        }
                        if (expandedEffect==effect.id) {
                            PocketMuted("Effect ${effect.id}\nApproval ${effect.approvalId}\n" +
                                "Payload SHA-256 ${effect.payloadDigest}\n" +
                                "Target SHA-256 ${effect.targetDigest}")
                        }
                    }
                }
            }
        }
        PocketMuted("Status hanya berasal dari respons server terakhir. " +
            "Timeout atau pembacaan gagal bukan bukti tindakan selesai.")
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
