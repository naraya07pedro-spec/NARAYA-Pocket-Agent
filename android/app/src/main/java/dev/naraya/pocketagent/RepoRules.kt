package dev.naraya.pocketagent

import java.util.Locale

/**
 * Pure validation, mirroring the backend's public-repository input boundary.
 * No URLs, credentials, arbitrary GitHub endpoints or private repository tokens.
 */
object RepoRules {
    private val ownerPattern = Regex("^[A-Za-z0-9][A-Za-z0-9-]{0,38}$")
    private val repoPattern = Regex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")

    fun normalize(raw: String): String? {
        val value = raw.trim()
        if (value.count { it == '/' } != 1) return null
        val parts = value.split('/')
        if (parts.size != 2) return null
        val (owner, repo) = parts
        if (!ownerPattern.matches(owner) || !repoPattern.matches(repo)) return null
        if (repo.endsWith('.') || repo.contains("..")) return null
        return "${owner.lowercase(Locale.ROOT)}/${repo.lowercase(Locale.ROOT)}"
    }
}
