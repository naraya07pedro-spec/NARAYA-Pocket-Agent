package dev.naraya.pocketagent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = DraftStore(applicationContext)
        setContent {
            val colors = darkColorScheme(
                primary = Color(0xFF6BD6C3),
                surface = Color(0xFF10191C),
                background = Color(0xFF0B1114),
                onSurface = Color(0xFFF1F5F4),
                onBackground = Color(0xFFF1F5F4),
            )
            MaterialTheme(colorScheme = colors) {
                MonitorDraftScreen(
                    store = store,
                    github = remember { GithubHeadClient() },
                    cloud = remember { CloudSyncClient(BuildConfig.CLOUD_API_ORIGIN) },
                    identity = remember { GoogleIdentityClient(this) },
                    webClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID,
                )
            }
        }
    }
}

private fun readableError(code: HeadError) = when (code) {
    HeadError.INVALID_REPOSITORY -> "Invalid public repository"
    HeadError.RATE_LIMITED -> "GitHub rate limit reached. Try again later."
    HeadError.NOT_FOUND -> "Repository unavailable or has no commits"
    HeadError.UPSTREAM_ERROR -> "GitHub could not complete this request"
    HeadError.INVALID_PROVIDER_DATA -> "GitHub response was invalid or too large"
    HeadError.NETWORK_ERROR -> "Network error. Your last saved snapshot is unchanged."
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MonitorDraftScreen(
    store: DraftStore,
    github: GithubHeadClient,
    cloud: CloudSyncClient,
    identity: GoogleIdentityClient,
    webClientId: String,
) {
    var draftRepo by remember { mutableStateOf("") }
    var interval by remember { mutableStateOf(60) }
    var drafts by remember { mutableStateOf(store.list()) }
    var notice by remember { mutableStateOf("") }
    var checkingId by remember { mutableStateOf<String?>(null) }
    val session = remember { EphemeralIdToken() } // RAM only; never rememberSaveable.
    var signedIn by remember { mutableStateOf(false) }
    var cloudBusy by remember { mutableStateOf(false) }
    var cloudRows by remember { mutableStateOf<List<CloudMonitor>>(emptyList()) }
    var observedMonitorId by remember { mutableStateOf<String?>(null) }
    var remoteObservations by remember { mutableStateOf<List<CloudObservation>>(emptyList()) }
    var cloudNotice by remember { mutableStateOf("") }
    val cloudConfigured = webClientId.isNotBlank() && CloudSyncClient.validOrigin(BuildConfig.CLOUD_API_ORIGIN)
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = { TopAppBar(title = { Text("NARAYA Pocket Agent") }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("MANUAL GITHUB PREVIEW · OPT-IN CLOUD CONTROLS", color = Color(0xFF6BD6C3),
                        style = MaterialTheme.typography.labelLarge)
                    Text("Check a public repository", style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold)
                    Text(
                        "Check now reads public GitHub once and saves the latest SHA offline. " +
                            "Cloud control is optional and disabled without trusted OAuth/Worker configuration; " +
                            "this Android app never schedules background checks.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            item {
                Card(shape = RoundedCornerShape(18.dp)) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedTextField(
                            value = draftRepo,
                            onValueChange = { draftRepo = it.take(145) },
                            label = { Text("Public GitHub repository") },
                            placeholder = { Text("owner/repository") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text("Cloud check interval (activation requires separate approval)", style = MaterialTheme.typography.labelMedium)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (option in listOf(30, 60, 120)) {
                                if (interval == option) Button(onClick = { interval = option }) { Text("${option}m") }
                                else OutlinedButton(onClick = { interval = option }) { Text("${option}m") }
                            }
                        }
                        Button(onClick = {
                            notice = when {
                                RepoRules.normalize(draftRepo) == null -> "Use a valid public repository: owner/repo"
                                store.add(draftRepo, interval) -> {
                                    drafts = store.list()
                                    draftRepo = ""
                                    "Saved locally. You can check a repo manually below."
                                }
                                else -> "Duplicate, storage error, or 20-draft limit"
                            }
                        }, modifier = Modifier.fillMaxWidth()) { Text("Save repository") }
                        if (notice.isNotBlank()) Text(notice, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item {
                Card(shape = RoundedCornerShape(18.dp)) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Cloud sync · explicit permission", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Google sign-in is required before uploading any public repository draft. " +
                                "ID tokens stay in memory; no token is saved locally. " +
                                "Remote cloud execution has NOT been verified.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        if (!cloudConfigured) {
                            Text("Cloud sync unavailable in this build. Missing public OAuth/Worker configuration.",
                                style = MaterialTheme.typography.bodyMedium)
                        } else {
                            if (!signedIn) {
                                Button(
                                    enabled = !cloudBusy,
                                    onClick = {
                                        cloudBusy = true
                                        cloudNotice = "Opening Google sign-in..."
                                        scope.launch {
                                            val token = identity.signIn(webClientId)
                                            signedIn = token != null && session.replace(token)
                                            cloudNotice = if (signedIn) "Google ID token obtained. Refresh cloud state to verify backend access."
                                                else "Sign-in unavailable or canceled; no cloud request was made."
                                            cloudBusy = false
                                        }
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                ) { Text("Sign in with Google") }
                            } else {
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Button(
                                        enabled = !cloudBusy,
                                        onClick = {
                                            cloudBusy = true
                                            scope.launch {
                                                val result = withContext(Dispatchers.IO) { cloud.list(session.read()) }
                                                when (result) {
                                                    is SyncResult.Listed -> {
                                                        cloudRows = result.monitors
                                                        observedMonitorId = null
                                                        remoteObservations = emptyList()
                                                        cloudNotice = "Server returned ${result.monitors.size} monitor(s); cloud state refreshed."
                                                    }
                                                    is SyncResult.Failed -> {
                                                        if (result.code == SyncFailure.UNAUTHORIZED) {
                                                            session.clear()
                                                            signedIn = false
                                                            cloudRows = emptyList()
                                                            observedMonitorId = null
                                                            remoteObservations = emptyList()
                                                        }
                                                        cloudNotice = "Cloud refresh failed: ${result.code}. Local drafts unchanged."
                                                    }
                                                    else -> cloudNotice = "Unexpected server response; local drafts unchanged."
                                                }
                                                cloudBusy = false
                                            }
                                        },
                                    ) { Text("Refresh cloud state") }
                                    OutlinedButton(
                                        enabled = !cloudBusy,
                                        onClick = {
                                            session.clear()
                                            signedIn = false
                                            cloudRows = emptyList()
                                            observedMonitorId = null
                                            remoteObservations = emptyList()
                                            cloudNotice = "Local session cleared."
                                            scope.launch { identity.signOut() }
                                        },
                                    ) { Text("Sign out") }
                                }
                                Text("Session exists only in app memory. Reauthentication is required after expiration or restart.",
                                    style = MaterialTheme.typography.bodySmall)
                                Text("These are last confirmed server states, NOT live cloud execution guarantees.",
                                    style = MaterialTheme.typography.bodySmall)
                                if (cloudRows.isNotEmpty()) Text("Server monitors (" + cloudRows.size + "/3)",
                                    style = MaterialTheme.typography.titleSmall)
                                cloudRows.forEach { remote ->
                                    HorizontalDivider()
                                    Text(remote.repository, fontWeight = FontWeight.Medium)
                                    Text("Stored server status: " + remote.status + " · version " + remote.version +
                                        " · ID " + remote.id.take(8), style = MaterialTheme.typography.bodySmall)
                                    Text(remote.executionSummary(), style = MaterialTheme.typography.bodySmall)
                                    Text("Eligibility is from the last successful server response, not a live Cron signal.",
                                        style = MaterialTheme.typography.bodySmall)
                                    if (remote.lastSha != null) {
                                        Text("Server-reported head: " + remote.lastSha.take(12),
                                            style = MaterialTheme.typography.bodySmall)
                                    } else Text("No server-confirmed GitHub head in this snapshot.",
                                        style = MaterialTheme.typography.bodySmall)
                                    val desired = if (remote.status == "ACTIVE") "PAUSED" else "ACTIVE"
                                    OutlinedButton(
                                        enabled = !cloudBusy,
                                        onClick = {
                                            cloudBusy = true
                                            cloudNotice = if (desired == "ACTIVE")
                                                "Requesting ACTIVE eligibility. This may schedule GitHub checks if the server gate is enabled."
                                            else "Requesting PAUSED state and in-flight lease invalidation."
                                            scope.launch {
                                                val outcome = withContext(Dispatchers.IO) {
                                                    cloud.changeStatus(session.read(), remote, desired)
                                                }
                                                when (outcome) {
                                                    is SyncResult.StatusChanged -> {
                                                        cloudRows = cloudRows.map { previous ->
                                                            if (previous.id == outcome.monitorId) previous.copy(
                                                                status = outcome.status,
                                                                version = outcome.version,
                                                                schedulerEligible = outcome.schedulerEligible,
                                                                scheduled = false,
                                                            ) else previous
                                                        }
                                                        cloudNotice = if (outcome.status == "ACTIVE")
                                                            "Server accepted activation eligibility. Cron and phone-off execution NOT verified."
                                                        else "Server confirmed PAUSED. Previously observed events are retained."
                                                    }
                                                    is SyncResult.Failed -> {
                                                        if (outcome.code == SyncFailure.UNAUTHORIZED) {
                                                            session.clear()
                                                            signedIn = false
                                                            cloudRows = emptyList()
                                                            observedMonitorId = null
                                                            remoteObservations = emptyList()
                                                        }
                                                        cloudNotice = if (outcome.code == SyncFailure.SCHEDULER_STORAGE_UNAVAILABLE)
                                                            "Activation blocked: server D1 scheduler budget is unavailable. " +
                                                                "No task was activated; an operator must check migrations 0001–0004. " +
                                                                "Refresh server state after it is repaired."
                                                        else "Status request failed: " + outcome.code +
                                                            ". No success assumed. Refresh server state before retrying."
                                                    }
                                                    else -> cloudNotice = "Unexpected status response. No change confirmed."
                                                }
                                                cloudBusy = false
                                            }
                                        },
                                    ) { Text(if (desired == "ACTIVE") "Request cloud activation" else "Pause cloud monitor") }
                                    OutlinedButton(
                                        enabled = !cloudBusy,
                                        onClick = {
                                            cloudBusy = true
                                            cloudNotice = "Reading server observations for " + remote.repository + "..."
                                            scope.launch {
                                                val outcome = withContext(Dispatchers.IO) {
                                                    cloud.observations(session.read(), remote.id)
                                                }
                                                when (outcome) {
                                                    is SyncResult.Observed -> {
                                                        observedMonitorId = outcome.monitorId
                                                        remoteObservations = outcome.observations
                                                        cloudNotice = "Server returned " + outcome.observations.size +
                                                            " observation(s). This is not phone-off acceptance."
                                                    }
                                                    is SyncResult.Failed -> {
                                                        observedMonitorId = null
                                                        remoteObservations = emptyList()
                                                        if (outcome.code == SyncFailure.UNAUTHORIZED) {
                                                            session.clear()
                                                            signedIn = false
                                                            cloudRows = emptyList()
                                                        }
                                                        cloudNotice = "Observation read failed: " + outcome.code +
                                                            ". No cloud events were invented."
                                                    }
                                                    else -> cloudNotice = "Unexpected observation response."
                                                }
                                                cloudBusy = false
                                            }
                                        },
                                    ) { Text("Read server observations") }
                                    if (observedMonitorId == remote.id) {
                                        if (remoteObservations.isEmpty()) Text("Server returned no observations.",
                                            style = MaterialTheme.typography.bodySmall)
                                        remoteObservations.take(5).forEach { observation ->
                                            Text(observation.type + ": " + observation.headSha.take(12) + " · " +
                                                DateFormat.getDateTimeInstance().format(Date(observation.observedAt)),
                                                style = MaterialTheme.typography.bodySmall)
                                        }
                                        if (remoteObservations.size > 5) Text("Showing first 5 of " +
                                            remoteObservations.size + " observations.",
                                            style = MaterialTheme.typography.bodySmall)
                                    }
                                }

                            }
                        }
                        if (cloudNotice.isNotBlank()) Text(cloudNotice, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item { Text("Saved on this phone · ${drafts.size}/20", style = MaterialTheme.typography.titleMedium) }
            if (drafts.isEmpty()) {
                item { Text("No repositories added. Add one above.", style = MaterialTheme.typography.bodyMedium) }
            }
            items(drafts, key = { it.id }) { draft ->
                Card(shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(draft.repository, fontWeight = FontWeight.Medium)
                        Text("Every ${draft.intervalMinutes} min · CLOUD DRAFT ONLY", style = MaterialTheme.typography.bodySmall)
                        if (draft.lastHeadSha != null && draft.lastCheckedAt != null) {
                            Text("Last saved SHA: ${draft.lastHeadSha.take(12)}", style = MaterialTheme.typography.bodyMedium)
                            Text("Checked manually: " +
                                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                                    .format(Date(draft.lastCheckedAt)), style = MaterialTheme.typography.bodySmall)
                        } else Text("No verified local snapshot yet", style = MaterialTheme.typography.bodySmall)
                        val remote = cloudRows.firstOrNull { it.clientDraftId == draft.id }
                        if (remote != null) {
                            Text("Stored server state: ${remote.status} · version ${remote.version} · ID ${remote.id.take(8)}",
                                style = MaterialTheme.typography.bodySmall)
                            Text(remote.executionSummary(), style = MaterialTheme.typography.bodySmall)
                        } else if (signedIn) {
                            Text("No verified server mapping loaded.", style = MaterialTheme.typography.bodySmall)
                        }
                        if (signedIn && cloudConfigured) {
                            OutlinedButton(
                                enabled = !cloudBusy && checkingId == null,
                                onClick = {
                                    cloudBusy = true
                                    cloudNotice = "Uploading exactly one public repository draft..."
                                    scope.launch {
                                        val result = withContext(Dispatchers.IO) { cloud.upload(session.read(), draft) }
                                        when (result) {
                                            is SyncResult.Uploaded -> {
                                                cloudRows = cloudRows.filterNot { it.clientDraftId == result.monitor.clientDraftId } +
                                                    result.monitor
                                                cloudNotice = if (result.created)
                                                    "Server confirmed PAUSED cloud monitor for ${draft.repository}; not remotely executed."
                                                else "Server confirmed existing mapping for ${draft.repository}; no new duplicate."
                                            }
                                            is SyncResult.Failed -> {
                                                if (result.code == SyncFailure.UNAUTHORIZED) {
                                                    session.clear()
                                                    signedIn = false
                                                    cloudRows = emptyList()
                                                    observedMonitorId = null
                                                    remoteObservations = emptyList()
                                                }
                                                cloudNotice = "Cloud upload failed: ${result.code}; local draft and verified SHA preserved."
                                            }
                                            else -> cloudNotice = "Unexpected cloud response; local draft unchanged."
                                        }
                                        cloudBusy = false
                                    }
                                },
                            ) { Text(if (cloudBusy) "Syncing..." else "Sync this draft to cloud") }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                enabled = checkingId == null,
                                onClick = {
                                    checkingId = draft.id
                                    notice = "Checking ${draft.repository} from GitHub..."
                                    scope.launch {
                                        val result = withContext(Dispatchers.IO) { github.check(draft.repository) }
                                        when (result) {
                                            is HeadCheckResult.Success -> {
                                                val saved = withContext(Dispatchers.IO) {
                                                    store.recordHead(draft.id, result.sha, System.currentTimeMillis())
                                                }
                                                if (saved) {
                                                    drafts = store.list()
                                                    notice = when {
                                                        draft.lastHeadSha == null -> "Baseline saved for ${draft.repository}"
                                                        draft.lastHeadSha != result.sha -> "Commit changed: ${draft.repository}"
                                                        else -> "No change: ${draft.repository}"
                                                    }
                                                } else notice = "Could not save snapshot; previous state preserved."
                                            }
                                            is HeadCheckResult.Failure -> notice = readableError(result.code)
                                        }
                                        checkingId = null
                                    }
                                }
                            ) { Text(if (checkingId == draft.id) "Checking..." else "Check now") }
                            OutlinedButton(
                                enabled = checkingId != draft.id,
                                onClick = {
                                    if (store.remove(draft.id)) {
                                        drafts = store.list()
                                        notice = "Local draft removed ONLY. Any separate cloud monitor remains unchanged; sign in and refresh cloud state."
                                    } else notice = "Could not save removal"
                                }
                            ) { Text("Remove local only") }
                        }
                    }
                }
            }
            item {
                HorizontalDivider()
                Text(
                    "Manual GitHub preview uses api.github.com without tokens. Optional explicit cloud " +
                        "sync sends the selected public repo and ephemeral Google ID token to the configured " +
                        "Worker. No operator API token, Android background process, or verified phone-off task.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
