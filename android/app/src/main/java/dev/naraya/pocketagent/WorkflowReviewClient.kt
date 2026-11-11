package dev.naraya.pocketagent

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * P2-F: explicit, RAM-token-only Android adapter for the bounded P2-C/D/E
 * synthetic workflow. No operator token, arbitrary URL, real CRM connector,
 * implicit retry, background service, or credential persistence.
 */
internal enum class ReviewFailure {
    NOT_CONFIGURED, SIGN_IN_REQUIRED, UNAUTHORIZED, NOT_FOUND, STALE_OR_CONFLICT,
    RATE_LIMITED, UNAVAILABLE, NETWORK_ERROR, INVALID_SERVER_RESPONSE,
}
internal sealed interface ReviewResult<out T> {
    data class Ok<T>(val value: T, val httpStatus: Int) : ReviewResult<T>
    data class Failed(val code: ReviewFailure) : ReviewResult<Nothing>
}
internal data class ReviewHttp(val status: Int, val body: String)
internal fun interface ReviewTransport {
    fun execute(origin: String, path: String, method: String, token: String, jsonBody: String?): ReviewHttp
}
internal data class ReviewTask(
    val id: String, val leadId: String, val status: String, val version: Int,
    val currentStep: Int,
)
internal data class ReviewApproval(
    val id: String, val status: String, val version: Int,
    val payloadDigest: String, val targetDigest: String, val expiresAt: Long,
)
internal data class ReviewEffect(
    val id: String, val taskId: String, val approvalId: String,
    val leadId: String, val serviceCode: String, val status: String,
    val payloadDigest: String, val targetDigest: String,
)
internal data class ReviewDispatch(
    val state: String, val attemptCount: Int, val reconcileCount: Int,
    val readback: String?, val safeToRetry: Boolean,
)
internal data class ReviewSnapshot(
    val tasks: List<ReviewTask>, val approvals: List<ReviewApproval>,
    val effects: List<ReviewEffect>,
)
internal data class ReviewDemo(val task: ReviewTask, val leadId: String)
internal data class ReviewTaskEffect(val approval: ReviewApproval, val effect: ReviewEffect)

private object WorkerReviewTransport : ReviewTransport {
    private const val MAX_REPLY = 16_384
    override fun execute(
        origin: String, path: String, method: String, token: String, jsonBody: String?,
    ): ReviewHttp {
        require(CloudSyncClient.validOrigin(origin) && WorkflowReviewClient.allowedRoute(path, method))
        require(CloudSyncClient.validIdTokenShape(token))
        require((method == "GET") == (jsonBody == null))
        if (jsonBody != null) require(jsonBody.toByteArray(StandardCharsets.UTF_8).size <= 4096)
        val connection = URL(origin + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 6_000
        connection.readTimeout = 6_000
        connection.useCaches = false
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("Accept", "application/json")
        if (method == "POST") {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
        }
        try {
            if (method == "POST") connection.outputStream.use {
                it.write(jsonBody!!.toByteArray(StandardCharsets.UTF_8))
            }
            val status = connection.responseCode
            if (status !in listOf(200, 201, 202)) return ReviewHttp(status, "")
            if (connection.contentLengthLong > MAX_REPLY) throw InvalidProviderBody()
            val bytes = connection.inputStream.use { stream ->
                val chunks = java.io.ByteArrayOutputStream()
                val part = ByteArray(2048)
                while (true) {
                    val size = stream.read(part)
                    if (size == -1) break
                    if (chunks.size() + size > MAX_REPLY) throw InvalidProviderBody()
                    chunks.write(part, 0, size)
                }
                chunks.toByteArray()
            }
            val decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            return ReviewHttp(status, decoder.decode(ByteBuffer.wrap(bytes)).toString())
        } finally {
            connection.disconnect()
        }
    }
}

internal class WorkflowReviewClient(
    private val origin: String,
    private val transport: ReviewTransport = WorkerReviewTransport,
) {
    companion object {
        private val uuid = Regex(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            RegexOption.IGNORE_CASE,
        )
        private val sha = Regex("^[0-9a-f]{64}$")
        private val taskDetail = Regex("^/v1/tasks/[0-9a-f-]{36}$")
        private val taskMutation = Regex("^/v1/tasks/[0-9a-f-]{36}/(advance|cancel)$")
        private val decisionPath = Regex("^/v1/approval-intents/[0-9a-f-]{36}/decision$")
        private val dispatchPath = Regex("^/v1/sandbox-dispatches/[0-9a-f-]{36}$")
        private val dispatchMutation = Regex(
            "^/v1/sandbox-dispatches/[0-9a-f-]{36}/(attempt|reconcile)$",
        )
        private fun safeId(value: String): String? = if (uuid.matches(value)) {
            try { UUID.fromString(value).toString() } catch (_: Exception) { null }
        } else null
        private fun scoped(path: String, prefix: String, suffix: String = ""): Boolean {
            if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false
            val id = path.removePrefix(prefix).removeSuffix(suffix)
            return safeId(id) != null && path == prefix + id + suffix
        }
        fun allowedRoute(path: String, method: String): Boolean = when (method) {
            "GET" -> path in setOf(
                "/v1/tasks", "/v1/approval-intents", "/v1/task-effects",
            ) || (taskDetail.matches(path) && scoped(path, "/v1/tasks/")) ||
                (dispatchPath.matches(path) && scoped(path, "/v1/sandbox-dispatches/"))
            "POST" -> path in setOf(
                "/v1/synthetic-leads", "/v1/tasks", "/v1/task-approvals",
            ) || (taskMutation.matches(path) && listOf("advance", "cancel").any {
                scoped(path, "/v1/tasks/", "/$it")
            }) || (decisionPath.matches(path) &&
                scoped(path, "/v1/approval-intents/", "/decision")) ||
                (dispatchMutation.matches(path) && listOf("attempt", "reconcile").any {
                    scoped(path, "/v1/sandbox-dispatches/", "/$it")
                })
            else -> false
        }
        fun newClientId(): String = UUID.randomUUID().toString()
        fun validId(value: String): Boolean = safeId(value) != null
    }

    private fun exchange(token: String?, method: String, path: String, body: String?): ReviewResult<JSONObject> {
        if (!CloudSyncClient.validOrigin(origin)) return ReviewResult.Failed(ReviewFailure.NOT_CONFIGURED)
        if (!CloudSyncClient.validIdTokenShape(token)) return ReviewResult.Failed(ReviewFailure.SIGN_IN_REQUIRED)
        if (!allowedRoute(path, method) || (method == "GET") != (body == null))
            return ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE)
        return try {
            val reply = transport.execute(origin, path, method, token!!, body)
            when (reply.status) {
                200, 201, 202 -> if (reply.body.toByteArray(StandardCharsets.UTF_8).size <= 16_384) {
                    ReviewResult.Ok(JSONObject(reply.body), reply.status)
                } else ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE)
                401, 403 -> ReviewResult.Failed(ReviewFailure.UNAUTHORIZED)
                404 -> ReviewResult.Failed(ReviewFailure.NOT_FOUND)
                409 -> ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT)
                429 -> ReviewResult.Failed(ReviewFailure.RATE_LIMITED)
                else -> ReviewResult.Failed(ReviewFailure.UNAVAILABLE)
            }
        } catch (_: IOException) {
            ReviewResult.Failed(ReviewFailure.NETWORK_ERROR)
        } catch (_: CharacterCodingException) {
            ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE)
        } catch (_: SecurityException) {
            ReviewResult.Failed(ReviewFailure.NETWORK_ERROR)
        } catch (_: Exception) {
            ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE)
        }
    }

    private fun text(obj: JSONObject, key: String): String {
        val raw = obj.get(key)
        require(raw is String)
        return raw
    }
    private fun int(obj: JSONObject, key: String): Int {
        val value = obj.get(key)
        require(value is Int || value is Long)
        val number = (value as Number).toLong()
        require(number in 0..Int.MAX_VALUE)
        return number.toInt()
    }
    private fun number(obj: JSONObject, key: String): Long {
        val value = obj.get(key)
        require(value is Int || value is Long)
        return (value as Number).toLong().also { require(it >= 0L) }
    }
    private fun bool(obj: JSONObject, key: String): Boolean {
        val raw = obj.get(key)
        require(raw is Boolean)
        return raw
    }
    private fun id(obj: JSONObject, key: String): String =
        safeId(text(obj, key)) ?: error("bad_id")
    private fun digest(obj: JSONObject, key: String): String =
        text(obj, key).also { require(sha.matches(it)) }
    private fun boundedRows(response: JSONObject, field: String, limit: Int = 10): List<JSONObject> {
        val rows = response.getJSONArray(field)
        require(rows.length() <= limit)
        return (0 until rows.length()).map { rows.getJSONObject(it) }
    }
    private fun task(obj: JSONObject): ReviewTask {
        require(text(obj,"kind") == "SYNTHETIC_LEAD_TRIAGE_V1")
        require(text(obj,"externalWrite") == "NOT_IMPLEMENTED")
        require(!bool(obj, "automaticDispatch"))
        val status = text(obj,"status")
        require(status in setOf("QUEUED","RUNNING","SUCCEEDED","FAILED","CANCELLED"))
        val version = int(obj,"version")
        val current = int(obj,"currentStep")
        require(version > 0 && current in 0..3)
        if (status == "SUCCEEDED") require(current == 3)
        return ReviewTask(id(obj,"id"),id(obj,"leadId"),status,version,current)
    }
    private fun approval(obj: JSONObject): ReviewApproval {
        require(text(obj,"externalWrite") == "NOT_IMPLEMENTED")
        require(!bool(obj,"eligibleForDispatch"))
        val status = text(obj,"status")
        require(status in setOf("PENDING","EXPIRED","APPROVED_NO_DISPATCH","DENIED"))
        val version = int(obj,"version")
        require(version > 0)
        return ReviewApproval(id(obj,"id"),status,version,
            digest(obj,"payloadDigest"),digest(obj,"targetDigest"),number(obj,"expiresAt"))
    }
    private fun effect(obj: JSONObject): ReviewEffect {
        require(text(obj,"provider") == "SYNTHETIC_ONLY")
        require(text(obj,"operation") == "CREATE_CRM_LEAD")
        require(text(obj,"target") == "synthetic-crm")
        require(text(obj,"externalWrite") == "NOT_IMPLEMENTED")
        require(!bool(obj,"eligibleForDispatch"))
        val status = text(obj,"status")
        require(status in setOf("AWAITING_APPROVAL","APPROVED_NO_DISPATCH","DENIED"))
        val serviceCode = text(obj,"serviceCode")
        require(serviceCode in setOf("EXHIBITION","INTERIOR","SIGNAGE"))
        return ReviewEffect(id(obj,"id"),id(obj,"taskId"),id(obj,"approvalId"),
            id(obj,"leadId"),serviceCode,status,
            digest(obj,"payloadDigest"),digest(obj,"targetDigest"))
    }
    private fun dispatch(obj: JSONObject): ReviewDispatch {
        require(text(obj,"simulatedProvider") == "D1_ONLY")
        require(text(obj,"externalWrite") == "NONE")
        val safe = bool(obj,"safeToRetry")
        require(!safe)
        val state = text(obj,"state")
        require(state in setOf("NOT_ATTEMPTED","PREPARED","IN_FLIGHT",
            "UNKNOWN_OUTCOME","CONFIRMED_APPLIED","QUARANTINED"))
        val attemptCount=int(obj,"attemptCount")
        val reconcileCount=int(obj,"reconcileCount")
        require(attemptCount in 0..1 && reconcileCount in 0..10)
        val readback = if (state == "NOT_ATTEMPTED") null else text(obj,"readback").also {
            require(it in setOf("NOT_CHECKED","FOUND_MATCH","NOT_FOUND_UNCERTAIN","FOUND_CONFLICT"))
        }
        return ReviewDispatch(state,attemptCount,reconcileCount,readback,safe)
    }
    private fun <T> parse(
        response: ReviewResult<JSONObject>, accepted: Set<Int>,
        decode: (JSONObject) -> T,
    ): ReviewResult<T> = when(response) {
        is ReviewResult.Failed -> response
        is ReviewResult.Ok -> try {
            if (response.httpStatus !in accepted)
                ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE)
            else ReviewResult.Ok(decode(response.value),response.httpStatus)
        } catch (_: Exception) {
            ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE)
        }
    }

    fun listTasks(token:String?): ReviewResult<List<ReviewTask>> = parse(
        exchange(token,"GET","/v1/tasks",null),setOf(200),
    ) { root ->
        boundedRows(root,"tasks").map(::task).also { rows ->
            require(rows.map { it.id }.toSet().size == rows.size)
        }
    }
    fun listApprovals(token:String?): ReviewResult<List<ReviewApproval>> = parse(
        exchange(token,"GET","/v1/approval-intents",null),setOf(200),
    ) { root ->
        boundedRows(root,"intents").map(::approval).also { rows ->
            require(rows.map { it.id }.toSet().size == rows.size)
        }
    }
    fun listEffects(token:String?): ReviewResult<List<ReviewEffect>> = parse(
        exchange(token,"GET","/v1/task-effects",null),setOf(200),
    ) { root ->
        boundedRows(root,"effects").map(::effect).also { rows ->
            require(rows.map { it.id }.toSet().size == rows.size)
        }
    }

    /** This creates only typed synthetic test data, not a customer lead. */
    fun createDemo(token:String?,leadId:String,clientTaskId:String,serviceCode:String):ReviewResult<ReviewDemo> {
        if (!validId(leadId) || !validId(clientTaskId) ||
            serviceCode !in setOf("EXHIBITION","INTERIOR","SIGNAGE"))
            return ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE)
        val leadBody = JSONObject()
            .put("clientLeadId",leadId).put("source","SYNTHETIC_FORM")
            .put("serviceCode",serviceCode).put("budgetBand","UNKNOWN")
            .put("daysToDeadline",30).toString()
        val createdLead = parse(
            exchange(token,"POST","/v1/synthetic-leads",leadBody),setOf(200,201),
        ) { root ->
            val lead=root.getJSONObject("lead")
            require(id(lead,"clientLeadId")==leadId)
            require(text(lead,"source")=="SYNTHETIC_FORM")
            require(text(lead,"serviceCode")==serviceCode)
            require(text(lead,"sendStatus")=="DRAFT_ONLY")
            require(text(lead,"classification")=="DETERMINISTIC_RULES_NOT_AI")
            digest(lead,"inputDigest")
        }
        if (createdLead is ReviewResult.Failed) return createdLead
        val taskBody = JSONObject()
            .put("clientTaskId",clientTaskId)
            .put("kind","SYNTHETIC_LEAD_TRIAGE_V1")
            .put("leadId",leadId).toString()
        return parse(
            exchange(token,"POST","/v1/tasks",taskBody),setOf(200,201),
        ) { root ->
            val result=task(root.getJSONObject("task"))
            require(result.leadId==leadId)
            ReviewDemo(result,leadId)
        }
    }
    fun advance(token:String?,t:ReviewTask):ReviewResult<ReviewTask> {
        if (!validId(t.id) || t.version < 1 || t.currentStep !in 0..2 ||
            t.status !in setOf("QUEUED","RUNNING"))
            return ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT)
        val body=JSONObject().put("expectedVersion",t.version).toString()
        return parse(exchange(token,"POST","/v1/tasks/${t.id}/advance",body),setOf(200)) {
            val result=task(it.getJSONObject("task"))
            require(result.id==t.id && result.version==t.version+2 &&
                result.currentStep==t.currentStep+1)
            result
        }
    }
    fun cancel(token:String?,t:ReviewTask):ReviewResult<ReviewTask> {
        if (!validId(t.id) || t.version < 1 || t.status !in setOf("QUEUED","RUNNING"))
            return ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT)
        val body=JSONObject().put("expectedVersion",t.version).toString()
        return parse(exchange(token,"POST","/v1/tasks/${t.id}/cancel",body),setOf(200)) {
            val result=task(it.getJSONObject("task"))
            require(result.id==t.id && result.status=="CANCELLED" &&
                result.version==t.version+1)
            result
        }
    }
    fun requestTaskApproval(token:String?,t:ReviewTask,serviceCode:String):ReviewResult<ReviewTaskEffect> {
        if(!validId(t.id)||!validId(t.leadId)||t.status!="SUCCEEDED"||
            t.currentStep!=3||serviceCode !in setOf("EXHIBITION","INTERIOR","SIGNAGE"))
            return ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT)
        val body=JSONObject().put("clientIntentId",UUID.nameUUIDFromBytes(
            ("naraya-p2f-task-approval:"+t.id).toByteArray(StandardCharsets.UTF_8)).toString())
            .put("taskId",t.id).put("provider","SYNTHETIC_ONLY")
            .put("operation","CREATE_CRM_LEAD").put("target","synthetic-crm")
            .put("payload",JSONObject().put("leadId",t.leadId)
                .put("serviceCode",serviceCode)).toString()
        // Stable UUID per task means a lost acknowledgement never creates a
        // second approval. Server additionally enforces one effect per task.
        return parse(exchange(token,"POST","/v1/task-approvals",body),setOf(200,201)) {
            val a=approval(it.getJSONObject("approval"))
            val e=effect(it.getJSONObject("effect"))
            require(e.taskId==t.id && e.leadId==t.leadId &&
                e.serviceCode==serviceCode && e.approvalId==a.id &&
                e.payloadDigest==a.payloadDigest && e.targetDigest==a.targetDigest)
            ReviewTaskEffect(a,e)
        }
    }
    fun decide(token:String?,a:ReviewApproval,e:ReviewEffect,approve:Boolean):ReviewResult<String> {
        if(a.status!="PENDING" || a.version < 1 || a.id!=e.approvalId||
            e.status!="AWAITING_APPROVAL"||
            a.payloadDigest!=e.payloadDigest||a.targetDigest!=e.targetDigest||
            a.expiresAt<=System.currentTimeMillis())
            return ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT)
        val desired=if(approve)"APPROVED_NO_DISPATCH" else "DENIED"
        val body=JSONObject().put("decision",if(approve)"APPROVE" else "DENY")
            .put("expectedVersion",a.version).put("payloadDigest",a.payloadDigest)
            .put("targetDigest",a.targetDigest).toString()
        return parse(exchange(token,"POST","/v1/approval-intents/${a.id}/decision",body),
            setOf(200)) { root ->
            require(id(root,"id")==a.id&&text(root,"status")==desired)
            require(int(root,"version")==a.version+1)
            require(text(root,"externalWrite")=="NOT_IMPLEMENTED")
            require(!bool(root,"eligibleForDispatch"))
            desired
        }
    }
    fun getDispatch(token:String?,effectId:String):ReviewResult<ReviewDispatch> {
        if(!validId(effectId))return ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE)
        return parse(exchange(token,"GET","/v1/sandbox-dispatches/$effectId",null),
            setOf(200)){ dispatch(it.getJSONObject("dispatch")) }
    }
    fun sandboxAttempt(token:String?,e:ReviewEffect):ReviewResult<ReviewDispatch> {
        if(!validId(e.id)||e.status!="APPROVED_NO_DISPATCH")
            return ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT)
        return parse(exchange(token,"POST","/v1/sandbox-dispatches/${e.id}/attempt","{}"),
            setOf(200,202)){ dispatch(it.getJSONObject("dispatch")) }
    }
    fun reconcile(token:String?,e:ReviewEffect):ReviewResult<ReviewDispatch> {
        if(!validId(e.id)||e.status!="APPROVED_NO_DISPATCH")
            return ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT)
        return parse(exchange(token,"POST","/v1/sandbox-dispatches/${e.id}/reconcile","{}"),
            setOf(200,202)){ dispatch(it.getJSONObject("dispatch")) }
    }
}
