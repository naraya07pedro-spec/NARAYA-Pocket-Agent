package dev.naraya.pocketagent

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.UUID

class WorkflowReviewClientTest {
    private val origin="https://agent.example.invalid"
    private val token="a".repeat(45)+"."+"b".repeat(55)+"."+"c".repeat(60)
    private val taskId=UUID.randomUUID().toString()
    private val leadId=UUID.randomUUID().toString()
    private val approvalId=UUID.randomUUID().toString()
    private val effectId=UUID.randomUUID().toString()
    private val payload="a".repeat(64)
    private val target="b".repeat(64)

    private fun task(status:String="RUNNING",version:Int=3,step:Int=1)=
        JSONObject().put("id",taskId).put("leadId",leadId)
            .put("kind","SYNTHETIC_LEAD_TRIAGE_V1").put("status",status)
            .put("version",version).put("currentStep",step)
            .put("externalWrite","NOT_IMPLEMENTED")
            .put("automaticDispatch",false)
    private fun approval(status:String="PENDING",version:Int=1)=
        JSONObject().put("id",approvalId).put("status",status)
            .put("version",version).put("payloadDigest",payload)
            .put("targetDigest",target).put("expiresAt",System.currentTimeMillis()+600_000)
            .put("externalWrite","NOT_IMPLEMENTED")
            .put("eligibleForDispatch",false)
    private fun effect(status:String="AWAITING_APPROVAL")=
        JSONObject().put("id",effectId).put("taskId",taskId)
            .put("approvalId",approvalId).put("leadId",leadId)
            .put("serviceCode","SIGNAGE").put("status",status)
            .put("payloadDigest",payload).put("targetDigest",target)
            .put("provider","SYNTHETIC_ONLY")
            .put("operation","CREATE_CRM_LEAD")
            .put("target","synthetic-crm")
            .put("externalWrite","NOT_IMPLEMENTED")
            .put("eligibleForDispatch",false)
    private fun lead()=JSONObject().put("clientLeadId",leadId)
        .put("serviceCode","SIGNAGE").put("source","SYNTHETIC_FORM")
        .put("sendStatus","DRAFT_ONLY")
        .put("classification","DETERMINISTIC_RULES_NOT_AI")
        .put("inputDigest","c".repeat(64))
    private fun dispatch(state:String="UNKNOWN_OUTCOME",safe:Boolean=false)=
        JSONObject().put("state",state).put("attemptCount",1)
            .put("reconcileCount",0).put("readback","NOT_FOUND_UNCERTAIN")
            .put("safeToRetry",safe).put("externalWrite","NONE")
            .put("simulatedProvider","D1_ONLY")
    private fun list(key:String,vararg rows:JSONObject)=
        JSONObject().put(key,JSONArray().also { a->rows.forEach(a::put) }).toString()

    @Test fun routesAreLiteralScopedAndNeverAcceptOperatorEndpointsOrArbitraryUrls(){
        val get=listOf("/v1/tasks","/v1/synthetic-leads","/v1/approval-intents",
            "/v1/task-effects","/v1/sandbox-dispatches/$effectId","/v1/tasks/$taskId")
        val post=listOf("/v1/synthetic-leads","/v1/tasks","/v1/task-approvals",
            "/v1/tasks/$taskId/advance","/v1/tasks/$taskId/cancel",
            "/v1/approval-intents/$approvalId/decision",
            "/v1/sandbox-dispatches/$effectId/attempt",
            "/v1/sandbox-dispatches/$effectId/reconcile")
        for(path in get)assertTrue(path,WorkflowReviewClient.allowedRoute(path,"GET"))
        for(path in post)assertTrue(path,WorkflowReviewClient.allowedRoute(path,"POST"))
        for((path,method) in listOf(
            "/v1/monitors" to "POST",
            "/v1/tasks" to "PATCH",
            "/v1/sandbox-dispatches/$effectId/dispatch" to "POST",
            "/v1/tasks/$taskId/advance" to "GET",
            "/v1/synthetic-leads?admin=1" to "GET",
            "/v1/tasks/../../admin" to "GET",
            "https://evil.invalid/v1/tasks" to "GET",
            "/v1/approval-intents/not-an-uuid/decision" to "POST",
            "/v1/sandbox-dispatches/$effectId/retry" to "POST"
        ))assertFalse(path,WorkflowReviewClient.allowedRoute(path,method))
    }
    @Test fun missingTokenAndInvalidOriginPreventAllNetworkAndOperatorCredentials(){
        var count=0
        val transport=ReviewTransport{_,_,_,_,_->count++;ReviewHttp(200,list("tasks"))}
        val client=WorkflowReviewClient(origin,transport)
        assertEquals(ReviewResult.Failed(ReviewFailure.SIGN_IN_REQUIRED),client.listTasks(null))
        assertEquals(ReviewResult.Failed(ReviewFailure.SIGN_IN_REQUIRED),
            client.listTasks("operator-long-bearer-without-a-jwt"))
        for(bad in listOf("","http://agent.example.invalid","https://evil.invalid/extra",
            "https://user@agent.example.invalid","https://agent.example.invalid?x=1")) {
            assertEquals(ReviewResult.Failed(ReviewFailure.NOT_CONFIGURED),
                WorkflowReviewClient(bad,transport).listTasks(token))
        }
        assertEquals(0,count)
    }
    @Test fun snapshotRequiresAllFourSignedOwnerPagesAndTypedSafeFlags(){
        val seen=mutableListOf<String>()
        val fake=ReviewTransport{dest,path,method,bearer,body->
            assertEquals(origin,dest);assertEquals(token,bearer)
            assertEquals("GET",method);assertNull(body)
            seen.add(path)
            ReviewHttp(200,when(path){
                "/v1/synthetic-leads"->list("leads",lead())
                "/v1/tasks"->list("tasks",task())
                "/v1/approval-intents"->list("intents",approval())
                "/v1/task-effects"->list("effects",effect())
                else->error("unlisted route")
            })
        }
        val result=WorkflowReviewClient(origin,fake).snapshot(token) as ReviewResult.Ok
        assertEquals(listOf("/v1/synthetic-leads","/v1/tasks",
            "/v1/approval-intents","/v1/task-effects"),seen)
        assertEquals(1,result.value.leads.size)
        assertEquals(1,result.value.tasks.size)
        assertEquals(1,result.value.approvals.size)
        assertEquals(1,result.value.effects.size)
        assertEquals("SIGNAGE",result.value.leads.single().serviceCode)
        assertEquals("AWAITING_APPROVAL",result.value.effects.single().status)
        val forged=WorkflowReviewClient(origin,ReviewTransport{_,p,_,_,_->
            if(p=="/v1/tasks")ReviewHttp(200,list("tasks",task().put("automaticDispatch",true)))
            else ReviewHttp(200,list("leads",lead()))
        })
        assertEquals(ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE),forged.snapshot(token))
    }
    @Test fun versionedAdvanceAndCancelNeverInferSuccessFromWrongIdOrStatus(){
        val t=ReviewTask(taskId,leadId,"RUNNING",3,1)
        val fake=WorkflowReviewClient(origin,ReviewTransport{_,path,method,bearer,body->
            assertEquals("POST",method);assertEquals(token,bearer)
            assertEquals(setOf("expectedVersion"),JSONObject(body!!).keys().asSequence().toSet())
            assertEquals(3,JSONObject(body).getInt("expectedVersion"))
            ReviewHttp(200,if(path.endsWith("/advance"))
                JSONObject().put("task",task(version=5,step=2)).toString()
            else JSONObject().put("task",task("CANCELLED",version=4,step=1)).toString())
        })
        assertEquals(5,(fake.advance(token,t) as ReviewResult.Ok).value.version)
        assertEquals("CANCELLED",(fake.cancel(token,t) as ReviewResult.Ok).value.status)
        val wrong=WorkflowReviewClient(origin,ReviewTransport{_,_,_,_,_->
            ReviewHttp(200,JSONObject().put("task",task(version=4,step=2)).toString())
        })
        assertEquals(ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE),wrong.advance(token,t))
        assertEquals(ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT),
            fake.advance(token,t.copy(status="SUCCEEDED")))
    }
    @Test fun approvalDecisionSendsExactServerDigestsAndRequiresFailClosedAck(){
        val a=ReviewApproval(approvalId,"PENDING",1,payload,target,System.currentTimeMillis()+600000)
        val e=ReviewEffect(effectId,taskId,approvalId,leadId,"SIGNAGE",
            "AWAITING_APPROVAL",payload,target)
        val client=WorkflowReviewClient(origin,ReviewTransport{_,path,method,bearer,body->
            assertEquals("/v1/approval-intents/$approvalId/decision",path)
            assertEquals("POST",method);assertEquals(token,bearer)
            val sent=JSONObject(body!!)
            assertEquals(setOf("decision","expectedVersion","payloadDigest","targetDigest"),
                sent.keys().asSequence().toSet())
            assertEquals("APPROVE",sent.getString("decision"))
            assertEquals(payload,sent.getString("payloadDigest"))
            assertEquals(target,sent.getString("targetDigest"))
            assertEquals(1,sent.getInt("expectedVersion"))
            ReviewHttp(200,JSONObject().put("id",approvalId)
                .put("status","APPROVED_NO_DISPATCH").put("version",2)
                .put("externalWrite","NOT_IMPLEMENTED")
                .put("eligibleForDispatch",false).toString())
        })
        assertEquals("APPROVED_NO_DISPATCH",(client.decide(token,a,e,true) as ReviewResult.Ok).value)
        assertEquals(ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT),
            client.decide(token,a,e.copy(targetDigest="f".repeat(64)),true))
        assertEquals(ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT),
            client.decide(token,a.copy(status="EXPIRED"),e,true))
        val forged=WorkflowReviewClient(origin,ReviewTransport{_,_,_,_,_->
            ReviewHttp(200,JSONObject().put("id",approvalId)
                .put("status","APPROVED_NO_DISPATCH").put("version",2)
                .put("externalWrite","NOT_IMPLEMENTED")
                .put("eligibleForDispatch",true).toString())
        })
        assertEquals(ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE),
            forged.decide(token,a,e,true))
    }
    @Test fun simulatedProvider202RemainsUncertainAndNeverBecomesRetryAuthorization(){
        val e=ReviewEffect(effectId,taskId,approvalId,leadId,"SIGNAGE",
            "APPROVED_NO_DISPATCH",payload,target)
        var calls=0
        val client=WorkflowReviewClient(origin,ReviewTransport{_,path,method,_,body->
            assertTrue(path.contains(effectId))
            assertEquals("POST",method);assertEquals("{}",body)
            calls++
            ReviewHttp(202,JSONObject().put("dispatch",dispatch()).toString())
        })
        val uncertain=client.sandboxAttempt(token,e) as ReviewResult.Ok
        assertEquals("UNKNOWN_OUTCOME",uncertain.value.state)
        assertFalse(uncertain.value.safeToRetry)
        assertEquals("NOT_FOUND_UNCERTAIN",uncertain.value.readback)
        assertEquals("UNKNOWN_OUTCOME",(client.reconcile(token,e) as ReviewResult.Ok).value.state)
        assertEquals(2,calls)
        val illegal=WorkflowReviewClient(origin,ReviewTransport{_,_,_,_,_->
            ReviewHttp(202,JSONObject().put("dispatch",dispatch(safe=true)).toString())
        })
        assertEquals(ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE),
            illegal.sandboxAttempt(token,e))
    }
    @Test fun syntheticDemoUsesSameCallerIdsAndNeverAcceptsCustomerPII(){
        var phase=0
        val demo=WorkflowReviewClient(origin,ReviewTransport{_,path,method,_,body->
            assertEquals("POST",method)
            phase++
            when(phase){
                1->{
                    assertEquals("/v1/synthetic-leads",path)
                    val req=JSONObject(body!!)
                    assertEquals(setOf("clientLeadId","source","serviceCode",
                        "budgetBand","daysToDeadline"),req.keys().asSequence().toSet())
                    assertEquals(leadId,req.getString("clientLeadId"))
                    assertEquals("UNKNOWN",req.getString("budgetBand"))
                    ReviewHttp(201,JSONObject().put("lead",lead()).toString())
                }
                2->{
                    assertEquals("/v1/tasks",path)
                    val req=JSONObject(body!!)
                    assertEquals(setOf("clientTaskId","kind","leadId"),req.keys().asSequence().toSet())
                    assertEquals(leadId,req.getString("leadId"))
                    ReviewHttp(201,JSONObject().put("task",task("QUEUED",1,0)).toString())
                }
                else->error("Unexpected extra HTTP request")
            }
        })
        val result=demo.createDemo(token,leadId,UUID.randomUUID().toString(),"SIGNAGE")
        assertTrue(result is ReviewResult.Ok)
        assertEquals(2,phase)
        assertEquals(leadId,(result as ReviewResult.Ok).value.task.leadId)
    }
    @Test fun approvalCreationUsesStableTaskKeyAndNeverCallsUnapprovedOrArbitraryProvider(){
        val t=ReviewTask(taskId,leadId,"SUCCEEDED",7,3)
        val e=effect("AWAITING_APPROVAL")
        val a=approval()
        val keys=mutableListOf<String>()
        val client=WorkflowReviewClient(origin,ReviewTransport{_,path,_,_,body->
            assertEquals("/v1/task-approvals",path)
            val req=JSONObject(body!!)
            assertEquals("SYNTHETIC_ONLY",req.getString("provider"))
            assertEquals("synthetic-crm",req.getString("target"))
            assertEquals(taskId,req.getString("taskId"))
            keys.add(req.getString("clientIntentId"))
            ReviewHttp(201,JSONObject().put("approval",a).put("effect",e).toString())
        })
        assertTrue(client.requestTaskApproval(token,t,"SIGNAGE") is ReviewResult.Ok)
        assertTrue(client.requestTaskApproval(token,t,"SIGNAGE") is ReviewResult.Ok)
        assertEquals(2,keys.size)
        assertEquals(keys[0],keys[1])
        assertTrue(WorkflowReviewClient.validId(keys.single()))
        assertEquals(ReviewResult.Failed(ReviewFailure.STALE_OR_CONFLICT),
            client.requestTaskApproval(token,t.copy(status="RUNNING"),"SIGNAGE"))
    }
    @Test fun rejectedAndOversizedResponsesNeverLeakRawBodiesOrClaimDone(){
        for((status,code) in listOf(
            401 to ReviewFailure.UNAUTHORIZED,409 to ReviewFailure.STALE_OR_CONFLICT,
            429 to ReviewFailure.RATE_LIMITED,503 to ReviewFailure.UNAVAILABLE,
        )){
            val client=WorkflowReviewClient(origin,ReviewTransport{_,_,_,_,_->
                ReviewHttp(status,"secret-token-$token")
            })
            val got=client.listTasks(token)
            assertEquals(ReviewResult.Failed(code),got)
            assertFalse(got.toString().contains(token))
        }
        val large=WorkflowReviewClient(origin,ReviewTransport{_,_,_,_,_->
            ReviewHttp(200," ".repeat(16_385))
        })
        assertEquals(ReviewResult.Failed(ReviewFailure.INVALID_SERVER_RESPONSE),
            large.listTasks(token))
        val broken=WorkflowReviewClient(origin,ReviewTransport{_,_,_,_,_->
            throw IOException("raw bearer $token")
        })
        assertEquals(ReviewResult.Failed(ReviewFailure.NETWORK_ERROR),broken.listTasks(token))
    }
}
