plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}
// These are public deployment identifiers, NOT tokens or client secrets.
// Checked-in builds have empty defaults and cannot sign in or contact a Worker.
val candidateClientId = providers.gradleProperty("narayaGoogleWebClientId").orElse("").get()
val candidateApiOrigin = providers.gradleProperty("narayaApiOrigin").orElse("").get()
val webClientId = if (Regex("^[0-9]{5,}-[A-Za-z0-9_-]{12,}\\.apps\\.googleusercontent\\.com$").matches(candidateClientId))
    candidateClientId else ""
val apiOrigin = if (Regex("^https://[A-Za-z0-9][A-Za-z0-9.-]{0,252}$").matches(candidateApiOrigin))
    candidateApiOrigin else ""

android {
    namespace = "dev.naraya.pocketagent"
    compileSdk = 37
    defaultConfig {
        applicationId = "dev.naraya.pocketagent"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.3.0-alpha"
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"" + webClientId + "\"")
        buildConfigField("String", "CLOUD_API_ORIGIN", "\"" + apiOrigin + "\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
}
dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
