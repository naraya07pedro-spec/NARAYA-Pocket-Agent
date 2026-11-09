package dev.naraya.pocketagent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RepoRulesTest {
    @Test fun normalizesPublicGithubSlugs() {
        assertEquals("python/cpython", RepoRules.normalize(" Python/CPython "))
        assertEquals("owner/name_repo.git", RepoRules.normalize("Owner/name_repo.git"))
    }
    @Test fun blocksUrlsTraversalAndInvalidNames() {
        for (value in listOf("", "https://github.com/x/y", "a/../b", "a/b..c",
            "a/b.", "/repo", "a/", "a/b/c", "a/repo?token=secret", "a/ repo",
            "a".repeat(40)+"/repo")) {
            assertNull("Should reject: $value", RepoRules.normalize(value))
        }
    }
}
