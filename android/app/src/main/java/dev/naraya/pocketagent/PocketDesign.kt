package dev.naraya.pocketagent

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * P2-G: intentionally quiet, text-first product language.
 * No fabricated agent metrics, connection lamps or provider success charts.
 * All controls are native Material3 with 48dp+ touch targets.
 */
internal object PocketInk {
    val canvas = Color(0xFF111617)
    val surface = Color(0xFF1A2122)
    val surfaceRaised = Color(0xFF222B2C)
    val border = Color(0xFF34403F)
    val primary = Color(0xFFE9EEEA)
    val muted = Color(0xFFA5B1AC)
    val accent = Color(0xFF91C5B4)
    val accentSurface = Color(0xFF20362F)
    val caution = Color(0xFFDFB878)
    val cautionSurface = Color(0xFF3B3020)
    val danger = Color(0xFFDD998F)
}

@Composable
internal fun PocketPanel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, PocketInk.border),
        colors = CardDefaults.cardColors(containerColor = PocketInk.surface),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

@Composable
internal fun PocketEyebrow(label: String) {
    Text(
        label.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        color = PocketInk.accent,
        letterSpacing = 1.4.sp,
    )
}

@Composable
internal fun PocketMuted(label: String) {
    Text(label, style = MaterialTheme.typography.bodySmall, color = PocketInk.muted)
}

@Composable
internal fun PocketTag(label: String, caution: Boolean = false) {
    Surface(
        shape = RoundedCornerShape(7.dp),
        color = if (caution) PocketInk.cautionSurface else PocketInk.accentSurface,
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            color = if (caution) PocketInk.caution else PocketInk.accent,
        )
    }
}

@Composable
internal fun PocketHeader() {
    Row(
        modifier = Modifier.fillMaxWidth().background(PocketInk.canvas)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier.size(35.dp).background(PocketInk.accentSurface, RoundedCornerShape(9.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("N", color = PocketInk.accent, fontWeight = FontWeight.Black,
                style = MaterialTheme.typography.titleMedium)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text("NARAYA", style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Text("POCKET AGENT", style = MaterialTheme.typography.labelSmall,
                color = PocketInk.muted)
        }
        Text("PREVIEW", style = MaterialTheme.typography.labelSmall, color = PocketInk.muted)
    }
}

@Composable
internal fun PocketBottomNavigation(selected: PocketTab, onSelect: (PocketTab) -> Unit) {
    NavigationBar(containerColor = PocketInk.surface, tonalElevation = 0.dp) {
        listOf(
            Triple(PocketTab.HOME, "Beranda", "01"),
            Triple(PocketTab.TASKS, "Tugas", "02"),
            Triple(PocketTab.APPROVALS, "Approval", "03"),
            Triple(PocketTab.MONITOR, "Monitor", "04"),
        ).forEach { (tab, label, index) ->
            NavigationBarItem(
                selected = selected == tab,
                onClick = { onSelect(tab) },
                icon = {
                    Text(index, style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = if (selected == tab) PocketInk.accent else PocketInk.muted)
                },
                label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                alwaysShowLabel = true,
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = PocketInk.accent,
                    selectedTextColor = PocketInk.primary,
                    unselectedIconColor = PocketInk.muted,
                    unselectedTextColor = PocketInk.muted,
                    indicatorColor = PocketInk.accentSurface,
                ),
            )
        }
    }
}

@Composable
internal fun PocketHome(
    localDraftCount: Int,
    cloudConfigured: Boolean,
    signedIn: Boolean,
    onNavigate: (PocketTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                PocketEyebrow("WORKSPACE  /  PRIVATE ALPHA")
                Text(
                    "Pekerjaan jelas.\nKeputusan tetap milikmu.",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = PocketInk.primary,
                )
                Text(
                    "Kontrol task, persetujuan, dan pemantauan dari satu tempat. " +
                        "Belum ada eksekusi provider eksternal.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = PocketInk.muted,
                )
            }
        }
        item {
            PocketPanel {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()) {
                    PocketEyebrow("KONDISI SAAT INI")
                    PocketTag(if (!cloudConfigured) "BELUM DIATUR" else if (signedIn)
                        "SESI LOKAL" else "BELUM LOGIN", caution = true)
                }
                Text(
                    if (!cloudConfigured) "Koneksi cloud belum dikonfigurasi"
                    else if (!signedIn) "Login Google diperlukan"
                    else "Sesi tersedia, Worker belum diverifikasi",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                )
                PocketMuted(
                    "Status akun Cloudflare, Cron, dan operasi saat HP mati " +
                        "belum memiliki bukti pengujian langsung."
                )
                OutlinedButton(onClick = { onNavigate(PocketTab.MONITOR) }) {
                    Text("Buka koneksi & monitor")
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PocketEyebrow("AKSES CEPAT")
                PocketPanel {
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Tugas", style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold)
                            PocketMuted("Jalankan satu langkah manual dan periksa hasil.")
                        }
                        OutlinedButton(onClick = { onNavigate(PocketTab.TASKS) }) { Text("Buka") }
                    }
                    HorizontalDivider(color = PocketInk.border)
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Approval", style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold)
                            PocketMuted("Tinjau izin sebelum simulasi tindakan.")
                        }
                        OutlinedButton(onClick = { onNavigate(PocketTab.APPROVALS) }) { Text("Buka") }
                    }
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PocketEyebrow("PERANGKAT INI")
                Row(modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PocketPanel(modifier = Modifier.weight(1f)) {
                        Text(localDraftCount.toString(),
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold)
                        PocketMuted("Draft repo lokal")
                    }
                    PocketPanel(modifier = Modifier.weight(1f)) {
                        Text("MANUAL", style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold)
                        PocketMuted("Mode task saat ini")
                    }
                }
                PocketMuted("Angka hanya berasal dari penyimpanan aplikasi ini. " +
                    "Tidak ada angka sukses, lead, atau penggunaan cloud yang direka.")
            }
        }
        item {
            Spacer(Modifier.height(8.dp))
            HorizontalDivider(color = PocketInk.border)
            PocketMuted("P2-G visual system · kontrol tetap dibatasi izin dan status server.")
        }
    }
}

@Composable
internal fun PocketConnectionGate(
    cloudConfigured: Boolean,
    signedIn: Boolean,
    onMonitor: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        PocketEyebrow("AKSES TERBATAS  /  TIDAK ADA DEMO PALSU")
        Text(if (cloudConfigured) "Masuk untuk melihat data." else "Cloud belum diatur.",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold)
        PocketMuted(if (!cloudConfigured)
            "Build ini belum berisi alamat Worker HTTPS dan Google OAuth yang disetujui pemilik. " +
                "Tugas dan approval tidak akan dikarang sebagai contoh."
            else if (!signedIn)
                "Tugas dan approval hanya dapat dibaca setelah login Google. " +
                    "ID token berada di memori dan tidak disimpan."
            else "Sesi harus diverifikasi ulang.")
        PocketPanel {
            Text("Yang bisa dilakukan sekarang",
                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            PocketMuted("Gunakan Monitor untuk menyimpan draft GitHub lokal, " +
                "memeriksa commit publik secara manual, atau login bila koneksi sudah diatur.")
            Button(onClick = onMonitor) { Text("Buka Monitor") }
        }
    }
}
