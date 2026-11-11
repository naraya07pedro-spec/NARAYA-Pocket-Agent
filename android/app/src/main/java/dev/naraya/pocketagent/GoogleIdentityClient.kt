package dev.naraya.pocketagent

import androidx.activity.ComponentActivity
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

/**
 * Google sign-in is initiated ONLY from an explicit tap. Neither the Web OAuth
 * client ID (public configuration) nor the ID token is persisted in the APK cache.
 * There is no refresh token and no background sign-in.
 */
internal class GoogleIdentityClient(private val activity: ComponentActivity) {
    private val manager: CredentialManager = CredentialManager.create(activity)

    suspend fun signIn(webClientId: String): String? {
        if (!webClientId.matches(Regex("^[0-9]{5,}-[A-Za-z0-9_-]{12,}\\.apps\\.googleusercontent\\.com$")))
            return null
        val option = GetSignInWithGoogleOption.Builder(serverClientId = webClientId).build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        return try {
            val response = manager.getCredential(context = activity, request = request)
            val credential = response.credential
            if (credential !is CustomCredential ||
                credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) null
            else GoogleIdTokenCredential.createFrom(credential.data).idToken
                .takeIf { CloudSyncClient.validIdTokenShape(it) }
        } catch (_: GetCredentialException) {
            null
        } catch (_: GoogleIdTokenParsingException) {
            null
        }
    }

    suspend fun signOut() {
        try {
            manager.clearCredentialState(ClearCredentialStateRequest())
        } catch (_: ClearCredentialException) {
            // Provider clear failure cannot resurrect the RAM-only local session;
            // do not crash the sign-out coroutine on a credential-provider error.
        }
    }
}
