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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

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
                MonitorDraftScreen(store)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MonitorDraftScreen(store: DraftStore) {
    var draftRepo by remember { mutableStateOf("") }
    var interval by remember { mutableStateOf(60) }
    var drafts by remember { mutableStateOf(store.list()) }
    var notice by remember { mutableStateOf("") }
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
                    Text("OFFLINE PILOT · NO CLOUD CONNECTION", color = Color(0xFF6BD6C3), style = MaterialTheme.typography.labelLarge)
                    Text("Capture a monitor draft", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Drafts stay on this phone. Nothing is scheduled, sent to GitHub, or executed in the background yet. Cloud sync will require a verified user login.",
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
                        Text("Check interval (draft)", style = MaterialTheme.typography.labelMedium)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (option in listOf(30, 60, 120)) {
                                if (interval == option) {
                                    Button(onClick = { interval = option }) { Text("${option}m") }
                                } else {
                                    OutlinedButton(onClick = { interval = option }) { Text("${option}m") }
                                }
                            }
                        }
                        Button(onClick = {
                            notice = when {
                                RepoRules.normalize(draftRepo) == null -> "Use a valid public repository: owner/repo"
                                store.add(draftRepo, interval) -> {
                                    drafts = store.list()
                                    draftRepo = ""
                                    "Saved on this device. Cloud monitoring is not active."
                                }
                                else -> "Duplicate, storage error, or 20-draft limit"
                            }
                        }, modifier = Modifier.fillMaxWidth()) {
                            Text("Save offline draft")
                        }
                        if (notice.isNotBlank()) {
                            Text(notice, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            item {
                Text("Saved locally · ${drafts.size}/20", style = MaterialTheme.typography.titleMedium)
            }
            if (drafts.isEmpty()) {
                item {
                    Text("No drafts yet. Add one above to verify offline persistence.", style = MaterialTheme.typography.bodyMedium)
                }
            }
            items(drafts, key = { it.id }) { draft ->
                Card(shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(draft.repository, fontWeight = FontWeight.Medium)
                        Text("Every ${draft.intervalMinutes} minutes · DRAFT ONLY", style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick = {
                            if (store.remove(draft.id)) {
                                drafts = store.list()
                                notice = "Draft removed"
                            } else notice = "Could not save removal"
                        }) { Text("Remove") }
                    }
                }
            }
            item {
                HorizontalDivider()
                Text(
                    "Privacy: this alpha stores only public repository names, local draft IDs, and intervals. It has no INTERNET permission, backend token, Google login, or agent execution capability.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
