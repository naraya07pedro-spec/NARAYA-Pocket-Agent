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
                    Text("LIVE GITHUB PREVIEW · NO CLOUD TASKS", color = Color(0xFF6BD6C3),
                        style = MaterialTheme.typography.labelLarge)
                    Text("Check a public repository", style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold)
                    Text(
                        "Tap Check now for one read-only GitHub request. The last successful commit is saved offline. " +
                            "No automatic checks, cloud sync or background agent runs yet.",
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
                        Text("Future cloud interval (not active)", style = MaterialTheme.typography.labelMedium)
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
                                        notice = "Repository removed from this phone"
                                    } else notice = "Could not save removal"
                                }
                            ) { Text("Remove") }
                        }
                    }
                }
            }
            item {
                HorizontalDivider()
                Text(
                    "One manual HTTPS read goes directly to api.github.com. No GitHub token, " +
                        "owner Worker credential or personal records are uploaded. GitHub sees the " +
                        "requester's network address and requested public repository. " +
                        "No Android background execution or powered-off-phone monitoring is active.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
