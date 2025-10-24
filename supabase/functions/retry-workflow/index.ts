/**
 * Retry Workflow Edge Function
 *
 * Purpose:
 * - Monitors all processing inspections for stuck or failed agents
 * - Detects agents that are running for too long (timeout detection)
 * - Resets failed/stuck agents to pending status for retry
 * - Marks inspections as failed when agents exhaust max retries
 *
 * Execution:
 * - Triggered by pg_cron every 5 minutes
 * - Processes all inspections with status="processing"
 * - Self-contained: no external dependencies or RPC calls
 *
 * Architecture:
 * - Reads agent configurations dynamically from agent_executions table
 * - Uses Map data structure for efficient latest execution lookup
 * - Updates existing execution records to "pending" status for retry
 * - Dify workflow orchestrates the actual agent execution
 *
 * Key Features:
 * 1. Stuck Agent Detection: Finds agents running > 15 minutes
 * 2. Failed Agent Retry: Updates status to pending for retry
 * 3. Max Retry Handling: Marks inspection failed when retries exhausted
 * 4. No Hardcoded Configs: All agent metadata from database
 *
 * Flow:
 * 1. Query all processing inspections
 * 2. For each inspection:
 *    a. Get all agent executions
 *    b. Find latest attempt per agent
 *    c. Detect stuck agents (running > timeout)
 *    d. Detect failed agents (can retry)
 *    e. Detect exhausted agents (max retries reached)
 *    f. Mark stuck agents as timeout
 *    g. Update failed/stuck agents to pending status
 *    h. Mark inspection failed if any agent exhausted
 * 3. Return summary of all checks
 *
 * Response Structure:
 * {
 *   success: boolean,
 *   message: string,
 *   summary: {
 *     total_checked: number,
 *     healthy: number,
 *     issues_detected: number,
 *     failed: number,
 *     errors: number
 *   },
 *   results: [
 *     {
 *       inspection_id: string,
 *       status: "healthy" | "issues_detected" | "failed" | "error",
 *       stuck_agents?: string[],
 *       timed_out_agents?: string[],
 *       exhausted_agents?: string[],
 *       retried_executions?: { agent, execution_id, attempt, max_retries }[]
 *     }
 *   ]
 * }
 *
 * @module retry-workflow
 * @requires deno.land/std@0.168.0/http/server
 * @requires esm.sh/@supabase/supabase-js@2
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Supabase project URL from environment variables
 * @constant {string}
 */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

/**
 * Supabase service role key for bypassing RLS policies
 * @constant {string}
 */
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Timeout threshold for agent execution in milliseconds
 * If an agent is in "running" state for longer than this duration,
 * it will be marked as "timeout" and reset to pending for retry.
 *
 * Default: 15 minutes (900,000 ms)
 *
 * Rationale:
 * - Most agents should complete within 5-10 minutes
 * - 15 minutes provides buffer for slow LLM responses
 * - Longer timeouts risk workflow stalling indefinitely
 *
 * @constant {number}
 */
const AGENT_TIMEOUT_MS = 15 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

/**
 * Agent execution record from database
 */
interface AgentExecution {
  id: string;
  inspection_id: string;
  workflow_run_id: string;
  agent_name: string;
  agent_type: string;
  status:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "timeout"
    | "skipped"
    | "cancelled";
  attempt_number: number;
  max_retries: number;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  error_code: string | null;
  [key: string]: any;
}

/**
 * Inspection record from database
 */
interface Inspection {
  id: string;
  workflow_run_id: string;
  status: string;
  vin: string;
}

/**
 * Result for a single inspection check
 */
interface InspectionResult {
  inspection_id: string;
  status: "healthy" | "issues_detected" | "failed" | "no_agents" | "error";
  stuck_agents?: string[];
  timed_out_agents?: string[];
  exhausted_agents?: string[];
  retried_executions?: Array<{
    agent: string;
    execution_id: string;
    attempt: number;
    max_retries: number;
  }>;
  error?: string;
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Main edge function handler
 * Processes all inspections with status="processing" and detects:
 * - Stuck agents (running too long)
 * - Failed agents that can be retried
 * - Exhausted agents (max retries reached)
 *
 * Triggered by: pg_cron every 5 minutes
 *
 * @param {Request} req - HTTP request (not used, but required by Deno.serve)
 * @returns {Promise<Response>} JSON response with summary and detailed results
 */
serve(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    console.log(
      "[Retry Workflow] Starting agent timeout and stuck detection check..."
    );

    // ========================================================================
    // 1. Find Inspections with Processing Status
    // ========================================================================
    // Query all inspections that:
    // - Have status = "processing" (actively running)
    // - Have a workflow_run_id (workflow has started)
    // - Ordered by most recent first
    //
    // Why we check these:
    // - Only processing inspections can have stuck/failed agents
    // - workflow_run_id ensures workflow has actually started
    // - Most recent first prioritizes active workflows
    const { data: inspectionsNeedingCheck, error: queryError } = await supabase
      .from("inspections")
      .select("id, workflow_run_id, status, vin")
      .eq("status", "processing")
      .not("workflow_run_id", "is", null)
      .order("created_at", { ascending: false });

    if (queryError) {
      throw new Error(`Failed to query inspections: ${queryError.message}`);
    }

    if (!inspectionsNeedingCheck || inspectionsNeedingCheck.length === 0) {
      console.log("[Retry Workflow] No processing inspections found");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No processing inspections",
          processed: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[Retry Workflow] Found ${inspectionsNeedingCheck.length} processing inspections to check`
    );

    // ========================================================================
    // 2. Process Each Inspection
    // ========================================================================
    // Initialize results array to store outcome for each inspection
    const results: InspectionResult[] = [];
    const now = new Date();

    for (const inspection of inspectionsNeedingCheck) {
      try {
        console.log(
          `[Retry Workflow] Checking inspection ${inspection.id} (VIN: ${inspection.vin})`
        );

        // ====================================================================
        // 2.1. Fetch All Agent Executions
        // ====================================================================
        // Get all execution records for this inspection, sorted by:
        // - agent_name ASC: groups executions by agent
        // - attempt_number DESC: latest attempts first within each agent group
        //
        // This ordering allows us to easily pick the latest attempt per agent
        // using a Map data structure in the next step.
        const { data: allExecutions, error: executionsError } = await supabase
          .from("agent_executions")
          .select("*")
          .eq("inspection_id", inspection.id)
          .order("agent_name", { ascending: true })
          .order("attempt_number", { ascending: false });

        if (executionsError) {
          throw new Error(
            `Failed to fetch executions: ${executionsError.message}`
          );
        }

        if (!allExecutions || allExecutions.length === 0) {
          console.log(
            `[Retry Workflow] No agent executions found for inspection ${inspection.id}`
          );
          results.push({
            inspection_id: inspection.id,
            status: "no_agents",
          });
          continue;
        }

        // ====================================================================
        // 2.2. Extract Latest Execution Per Agent
        // ====================================================================
        // Use Map to get the latest attempt for each agent.
        // Since results are sorted by attempt_number DESC, the first occurrence
        // of each agent_name is the latest attempt.
        //
        // Example:
        // Input: [
        //   { agent_name: "cost_forecast", attempt: 3 },
        //   { agent_name: "cost_forecast", attempt: 2 },
        //   { agent_name: "market_value", attempt: 1 }
        // ]
        // Output Map: {
        //   "cost_forecast" => { agent_name: "cost_forecast", attempt: 3 },
        //   "market_value" => { agent_name: "market_value", attempt: 1 }
        // }
        const latestExecutions = new Map<string, AgentExecution>();
        for (const execution of allExecutions) {
          if (!latestExecutions.has(execution.agent_name)) {
            latestExecutions.set(execution.agent_name, execution);
          }
        }

        // ====================================================================
        // 2.3. Categorize Agents by Status
        // ====================================================================
        // Classify agents into three categories:
        //
        // 1. stuckAgents: Currently running but exceeded timeout
        //    - Action: Mark as timeout, create retry
        //
        // 2. timedOutAgents: Already failed/timeout but can retry
        //    - Action: Create retry execution record
        //
        // 3. exhaustedAgents: Failed/timeout and reached max retries
        //    - Action: Mark inspection as failed
        //
        // hasIssues: Flag to track if any retryable issues exist
        const stuckAgents: AgentExecution[] = [];
        const timedOutAgents: AgentExecution[] = [];
        const exhaustedAgents: AgentExecution[] = [];
        let hasIssues = false;

        for (const [agentName, execution] of latestExecutions) {
          // ------------------------------------------------------------------
          // Check for Stuck Agents
          // ------------------------------------------------------------------
          // An agent is "stuck" if:
          // 1. Status is "running" (actively executing)
          // 2. Has a started_at timestamp (execution began)
          // 3. Elapsed time exceeds AGENT_TIMEOUT_MS threshold
          //
          // Why we check this:
          // - Network issues, LLM hangs, or bugs can leave agents running
          // - Without timeout, workflow would never complete or fail
          // - 15-minute threshold balances responsiveness vs false positives
          if (execution.status === "running" && execution.started_at) {
            const startedAt = new Date(execution.started_at);
            const elapsedTime = now.getTime() - startedAt.getTime();

            if (elapsedTime > AGENT_TIMEOUT_MS) {
              // Check retries BEFORE updating status
              if (execution.attempt_number < execution.max_retries) {
                // Can retry - add to stuck agents for pending reset
                stuckAgents.push(execution);
                hasIssues = true;
              } else {
                // Can't retry - mark as timeout (terminal state)
                await supabase
                  .from("agent_executions")
                  .update({
                    status: "timeout",
                    error_message: `Agent stuck after max retries`,
                    completed_at: now.toISOString(),
                  })
                  .eq("id", execution.id);
                exhaustedAgents.push(execution);
              }
            }
          }

          // ------------------------------------------------------------------
          // Check for Failed/Timeout Agents That Can Be Retried
          // ------------------------------------------------------------------
          // An agent can be retried if:
          // 1. Status is "failed" or "timeout" (execution didn't complete)
          // 2. Current attempt_number < max_retries (retries available)
          //
          // Why separate from stuck agents:
          // - These agents already failed (not currently running)
          // - May have failed due to API errors, rate limits, or data issues
          // - Each agent has its own max_retries config in database
          if (["failed", "timeout"].includes(execution.status)) {
            if (execution.attempt_number < execution.max_retries) {
              timedOutAgents.push(execution);
              hasIssues = true;
              console.log(
                `[Retry Workflow] ${execution.agent_name} failed/timeout - attempt ${execution.attempt_number}/${execution.max_retries}`
              );
            } else {
              // ------------------------------------------------------------------
              // Check for Exhausted Agents
              // ------------------------------------------------------------------
              // Agent has used all available retry attempts
              // When any agent exhausts retries, the entire inspection fails
              // because we can't complete the workflow without all required agents
              exhaustedAgents.push(execution);
              console.log(
                `[Retry Workflow] ${execution.agent_name} max retries reached`
              );
            }
          }
        }

        // ====================================================================
        // 2.4. Handle Exhausted Agents
        // ====================================================================
        // If any agent has exhausted all retries, mark the inspection as failed.
        // This is a terminal state - no further retries will be attempted.
        //
        // Why fail the inspection:
        // - Workflow requires all agents to complete successfully
        // - If one agent consistently fails, the inspection can't be completed
        // - User needs to be notified rather than retrying indefinitely
        if (exhaustedAgents.length > 0) {
          const failedAgentNames = exhaustedAgents
            .map((e) => e.agent_name)
            .join(", ");
          await supabase
            .from("inspections")
            .update({
              status: "failed",
              error_message: `Agent(s) failed after max retries: ${failedAgentNames}`,
            })
            .eq("id", inspection.id);

          console.log(
            `[Retry Workflow] Marked inspection ${inspection.id} as failed due to exhausted agents`
          );
        }

        // ====================================================================
        // 2.5. Skip Inspection If Healthy
        // ====================================================================
        // If no stuck or failed agents found, this inspection is healthy.
        // Record the status and continue to next inspection.
        //
        // Note: exhaustedAgents may exist (which triggers "failed" status)
        // but hasIssues will be false (no retryable issues)
        if (!hasIssues) {
          console.log(
            `[Retry Workflow] Inspection ${inspection.id} has no retryable issues`
          );
          results.push({
            inspection_id: inspection.id,
            status: exhaustedAgents.length > 0 ? "failed" : "healthy",
            exhausted_agents: exhaustedAgents.map((e) => e.agent_name),
          });
          continue;
        }

        // ====================================================================
        // 3. Reset Failed/Stuck Agents to Pending Status
        // ====================================================================
        // For each problematic agent (stuck or failed), update the existing
        // execution record status back to "pending" so Dify can retry it.
        //
        // How Dify picks this up:
        // 1. We update existing record status to "pending"
        // 2. Dify workflow has conditional nodes checking for pending executions
        // 3. When found, Dify triggers the agent again
        // 4. Agent updates status to "running" when it starts
        // 5. Same attempt_number is used (no increment needed)
        //
        // Why this approach:
        // - Simpler: just update status, no new records
        // - Preserves execution history in single record
        // - Dify handles orchestration (execution order, dependencies)
        // - No need to trigger Dify API directly (less coupling)
        // - attempt_number only increments when actual execution starts
        const allProblematicAgents = [...stuckAgents, ...timedOutAgents];
        const retriedExecutions = [];

        for (const execution of allProblematicAgents) {
          // Safety check: Verify we haven't exceeded max retries
          // This should already be filtered in step 2.3, but we double-check
          // to prevent edge cases where max_retries might have changed
          if (execution.attempt_number >= execution.max_retries) {
            console.log(
              `[Retry Workflow] Skipping ${execution.agent_name} - max retries (${execution.max_retries}) reached`
            );
            continue;
          }

          // Update existing execution record back to pending status
          // This resets the agent for retry:
          // - status: "pending" (ready for Dify to pick up)
          // - Clear error fields (fresh start)
          // - Keep attempt_number same (increments when agent actually runs)
          // - Keep started_at/completed_at for history
          const { error: updateError } = await supabase
            .from("agent_executions")
            .update({
              status: "pending",
              error_message: null,
              error_code: null,
              error_stack: null,
            })
            .eq("id", execution.id);

          if (updateError) {
            console.error(
              `[Retry Workflow] Failed to update execution record for ${execution.agent_name}:`,
              updateError
            );
          } else {
            // Track successful retry setup for response
            retriedExecutions.push({
              agent: execution.agent_name,
              execution_id: execution.id,
              attempt: execution.attempt_number,
              max_retries: execution.max_retries,
            });
            console.log(
              `[Retry Workflow] Reset ${execution.agent_name} to pending (attempt ${execution.attempt_number}/${execution.max_retries})`
            );
          }
        }

        results.push({
          inspection_id: inspection.id,
          status: "issues_detected",
          stuck_agents: stuckAgents.map((e) => e.agent_name),
          timed_out_agents: timedOutAgents.map((e) => e.agent_name),
          exhausted_agents: exhaustedAgents.map((e) => e.agent_name),
          retried_executions: retriedExecutions,
        });

        console.log(
          `[Retry Workflow] ✓ Processed inspection ${inspection.id} - reset ${retriedExecutions.length} agents to pending`
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
    // 4. Return Summary
    // ========================================================================
    // Aggregate results by status category for high-level overview
    //
    // Status categories:
    // - healthy: No issues detected, all agents running smoothly
    // - issues_detected: Stuck/failed agents found and reset to pending
    // - failed: Agents exhausted retries, inspection marked failed
    // - errors: Unexpected errors during processing
    const healthy = results.filter((r) => r.status === "healthy").length;
    const issues = results.filter((r) => r.status === "issues_detected").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(
      `[Retry Workflow] Complete - Healthy: ${healthy}, Issues: ${issues}, Failed: ${failed}, Errors: ${errors}`
    );

    // Return comprehensive response with both summary and detailed results
    // This allows:
    // - Quick overview via summary counts
    // - Detailed inspection-level info via results array
    // - Monitoring and alerting based on summary metrics
    return new Response(
      JSON.stringify({
        success: true,
        message: `Checked ${results.length} inspections`,
        summary: {
          total_checked: results.length,
          healthy,
          issues_detected: issues,
          failed,
          errors,
        },
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    // ========================================================================
    // Fatal Error Handler
    // ========================================================================
    // Catches any unexpected errors that occur during execution
    // This should rarely happen if database queries fail or environment
    // variables are missing
    //
    // Returns 500 error with details for debugging
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

/**
 * Edge Function Export
 *
 * This function is automatically invoked by:
 * 1. pg_cron job (every 5 minutes) - automated monitoring
 * 2. Manual HTTP POST request - for testing or manual trigger
 *
 * No authentication required as it's called by pg_cron internally
 * Service role key provides necessary database permissions
 *
 * Example manual invocation:
 * ```bash
 * curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/retry-workflow \
 *   -H "Authorization: Bearer YOUR_ANON_KEY"
 * ```
 *
 * Example response:
 * ```json
 * {
 *   "success": true,
 *   "message": "Checked 5 inspections",
 *   "summary": {
 *     "total_checked": 5,
 *     "healthy": 3,
 *     "issues_detected": 1,
 *     "failed": 1,
 *     "errors": 0
 *   },
 *   "results": [
 *     {
 *       "inspection_id": "uuid",
 *       "status": "issues_detected",
 *       "stuck_agents": ["cost_forecast_agent"],
 *       "retried_executions": [
 *         {
 *           "agent": "cost_forecast_agent",
 *           "execution_id": "uuid",
 *           "attempt": 2,
 *           "max_retries": 3
 *         }
 *       ]
 *     }
 *   ]
 * }
 * ```
 */
