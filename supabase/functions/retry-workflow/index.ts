// supabase/functions/retry-workflow/index.ts

import { serve, ConnInfo } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// Configuration
// ============================================================================
const DIFY_API_URL = Deno.env.get("DIFY_API_URL") || "https://api.dify.ai/v1";
const DIFY_API_KEY = Deno.env.get("DIFY_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================================
// Types
// ============================================================================
interface AgentConfig {
  name: string;
  type: string;
  max_retries: number;
}

// ============================================================================
// Agent Configurations
// ============================================================================
const AGENT_CONFIGS: AgentConfig[] = [
  {
    name: "image_processing_agent",
    type: "image_processing",
    max_retries: 3,
  },
  {
    name: "cost_forecast_agent",
    type: "cost_forecast",
    max_retries: 3,
  },
  {
    name: "market_value_agent",
    type: "market_value",
    max_retries: 3,
  },
  {
    name: "expert_advice_agent",
    type: "expert_advice",
    max_retries: 3,
  },
  {
    name: "reconditioning_agent",
    type: "reconditioning",
    max_retries: 2,
  },
  {
    name: "condition_report_agent",
    type: "condition_report",
    max_retries: 2,
  },
];

// ============================================================================
// Main Handler - Automatic Retry (Called by Cron)
// ============================================================================
serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    console.log("[Retry Workflow] Starting automatic retry check...");

    // ========================================================================
    // 1. Find Inspections with Failed Agents that Need Retry
    // ========================================================================
    // // Get the single workflow_max_retries value
    // const { data: maxRetriesData, error: maxRetriesError } = await supabase
    //   .from("inspections")
    //   .select("workflow_max_retries")
    //   .single();

    // if (maxRetriesError) {
    //   throw new Error(`Failed to get max retries: ${maxRetriesError.message}`);
    // }

    // // Use the actual value for the comparison
    // const maxRetries = maxRetriesData?.workflow_max_retries;
    // if (maxRetries === undefined) {
    //   throw new Error("Max retries value is undefined");
    // }

    const { data: inspectionsNeedingRetry, error: queryError } = await supabase
      .from("inspections")
      .select(
        `
    id,
    workflow_run_id,
    workflow_retry_count,
    workflow_max_retries,
    workflow_last_retry_at,
    status,
    vin
  `
      )
      .in("status", ["processing", "failed"])
      .not("workflow_run_id", "is", null)
      .lt("workflow_retry_count", 3) // Use the integer value directly
      .order("created_at", { ascending: false })
    //   .limit(10); // Process 10 inspections at a time

    if (queryError) {
      throw new Error(`Failed to query inspections: ${queryError.message}`);
    }

    if (!inspectionsNeedingRetry || inspectionsNeedingRetry.length === 0) {
      console.log("[Retry Workflow] No inspections need retry");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No inspections need retry",
          processed: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[Retry Workflow] Found ${inspectionsNeedingRetry.length} inspections to check`
    );

    // ========================================================================
    // 2. Process Each Inspection
    // ========================================================================
    const results = [];

    for (const inspection of inspectionsNeedingRetry) {
      try {
        console.log(
          `[Retry Workflow] Processing inspection ${inspection.id} (VIN: ${inspection.vin})`
        );

        // Get all agent executions for this workflow
        const { data: allExecutions, error: executionsError } = await supabase
          .from("agent_executions")
          .select("*")
          .eq("inspection_id", inspection.id)
          //   .eq("workflow_run_id", inspection.workflow_run_id)
          .order("agent_name", { ascending: true })
          .order("attempt_number", { ascending: false });

        if (executionsError) {
          throw new Error(
            `Failed to fetch executions: ${executionsError.message}`
          );
        }

        // Get latest execution for each agent
        const latestExecutions = new Map<string, any>();
        for (const execution of allExecutions || []) {
          if (!latestExecutions.has(execution.agent_name)) {
            latestExecutions.set(execution.agent_name, execution);
          }
        }

        // Determine which agents need retry
        const failedAgents: string[] = [];
        let hasRetryableFailures = false;

        for (const agentConfig of AGENT_CONFIGS) {
          const latestExecution = latestExecutions.get(agentConfig.name);

          // Skip if no execution found (agent hasn't run yet - Dify will handle it)
          if (!latestExecution) {
            continue;
          }

          // Check if agent failed and can be retried
          if (["failed", "timeout"].includes(latestExecution.status)) {
            if (latestExecution.attempt_number < agentConfig.max_retries) {
              failedAgents.push(agentConfig.name);
              hasRetryableFailures = true;
              console.log(
                `[Retry Workflow] ${agentConfig.name} failed - attempt ${latestExecution.attempt_number}/${agentConfig.max_retries}`
              );
            } else {
              console.log(
                `[Retry Workflow] ${agentConfig.name} max retries reached`
              );
            }
          }
        }

        // Skip if no retryable failures
        if (!hasRetryableFailures) {
          console.log(
            `[Retry Workflow] Inspection ${inspection.id} has no retryable failures`
          );
          results.push({
            inspection_id: inspection.id,
            status: "skipped",
            reason: "no_retryable_failures",
          });
          continue;
        }

        // ====================================================================
        // 3. Update Inspection Retry Metadata
        // ====================================================================
        const newRetryCount = inspection.workflow_retry_count + 1;

        const { error: updateError } = await supabase
          .from("inspections")
          .update({
            workflow_retry_count: newRetryCount,
            workflow_last_retry_at: new Date().toISOString(),
            workflow_retry_reason: `Retrying ${
              failedAgents.length
            } failed agent(s): ${failedAgents.join(", ")}`,
            status: "processing",
          })
          .eq("id", inspection.id);

        if (updateError) {
          console.error(
            `[Retry Workflow] Failed to update inspection metadata:`,
            updateError
          );
        }

        // ====================================================================
        // 4. Initialize New Agent Execution Records for Retry
        // ====================================================================
        const newExecutions = [];

        for (const agentName of failedAgents) {
          const agentConfig = AGENT_CONFIGS.find((a) => a.name === agentName);
          if (!agentConfig) continue;

          const currentAttempt =
            latestExecutions.get(agentName)?.attempt_number || 0;
          const nextAttempt = currentAttempt + 1;

          // Insert new pending execution record
          const { data: newExecution, error: insertError } = await supabase
            .from("agent_executions")
            .insert({
              inspection_id: inspection.id,
              workflow_run_id: inspection.workflow_run_id,
              agent_name: agentConfig.name,
              agent_type: agentConfig.type,
              status: "pending",
              attempt_number: nextAttempt,
              max_retries: agentConfig.max_retries,
            })
            .select("id")
            .single();

          if (insertError) {
            console.error(
              `[Retry Workflow] Failed to create execution record for ${agentName}:`,
              insertError
            );
          } else {
            newExecutions.push({
              agent: agentName,
              execution_id: newExecution.id,
              attempt: nextAttempt,
            });
            console.log(
              `[Retry Workflow] Created pending execution for ${agentName} (attempt ${nextAttempt})`
            );
          }
        }

        // ====================================================================
        // 5. Trigger Dify Workflow (Fire and Forget)
        // ====================================================================
        console.log(
          `[Retry Workflow] Triggering Dify workflow for inspection ${inspection.id}`
        );

        // Trigger Dify workflow asynchronously (fire and forget)
        // fetch(`${DIFY_API_URL}/workflows/run`, {
        //   method: "POST",
        //   headers: {
        //     "Content-Type": "application/json",
        //     Authorization: `Bearer ${DIFY_API_KEY}`,
        //   },
        //   body: JSON.stringify({
        //     inputs: {
        //       inspection_id: inspection.id,
        //     },
        //     response_mode: "streaming", // Fire and forget
        //     user: `retry-${inspection.id}`,
        //   }),
        // })
        //   .then((res) => {
        //     if (!res.ok) {
        //       console.error(
        //         `[Retry Workflow] Dify API error for inspection ${inspection.id}: ${res.status}`
        //       );
        //     } else {
        //       console.log(
        //         `[Retry Workflow] Successfully triggered Dify workflow for inspection ${inspection.id}`
        //       );
        //     }
        //   })
        //   .catch((error) => {
        //     console.error(
        //       `[Retry Workflow] Failed to trigger Dify workflow for inspection ${inspection.id}:`,
        //       error
        //     );
        //   });

        results.push({
          inspection_id: inspection.id,
          status: "triggered",
          retry_count: newRetryCount,
          failed_agents: failedAgents,
          new_executions: newExecutions,
        });

        console.log(
          `[Retry Workflow] ✓ Processed inspection ${inspection.id} - triggered retry`
        );
      } catch (error: any) {
        console.error(
          `[Retry Workflow] Error processing inspection ${inspection.id}:`,
          error
        );
        results.push({
          inspection_id: inspection.id,
          status: "error",
          error: error.message,
        });
      }
    }

    // ========================================================================
    // 6. Return Summary
    // ========================================================================
    const triggered = results.filter((r) => r.status === "triggered").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(
      `[Retry Workflow] Complete - Triggered: ${triggered}, Skipped: ${skipped}, Errors: ${errors}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${results.length} inspections`,
        summary: {
          total_processed: results.length,
          triggered,
          skipped,
          errors,
        },
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[Retry Workflow] Fatal Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
