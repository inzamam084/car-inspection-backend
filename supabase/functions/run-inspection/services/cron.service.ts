import { logInfo, logError, logDebug } from "../utils/logger.ts";
import { fetchRecentN8nExecutions } from "./n8n.service.ts";
import {
  saveReportAndTrackUsage,
  updateInspectionStatus,
} from "./report.service.ts";
import { supabase } from "../config/supabase.config.ts";

const TIMEOUT_THRESHOLD_MINUTES = 15;
const PROCESSING_WINDOW_MINUTES = 20;

/**
 * Poll N8N for completed executions and update inspections
 * Called by pg_cron job
 */
export async function pollN8nAndUpdateInspections(
  requestId: string
): Promise<{
  success: boolean;
  processed: number;
  timedOut: number;
  errors: number;
  details?: string[];
}> {
  const details: string[] = [];
  let processed = 0;
  let timedOut = 0;
  let errors = 0;

  try {
    logInfo(requestId, "Starting N8N polling cycle");

    // 1. First, fetch processing inspections from last 20 minutes
    const processingThreshold = new Date(
      Date.now() - PROCESSING_WINDOW_MINUTES * 60 * 1000
    ).toISOString();

    const { data: processingInspections, error: inspectionError } = await supabase
      .from("inspections")
      .select("id, user_id, created_at, updated_at")
      .eq("status", "processing")
      .gte("updated_at", processingThreshold);

    if (inspectionError) {
      logError(requestId, "Failed to fetch processing inspections", {
        error: inspectionError.message,
      });
      return {
        success: false,
        processed: 0,
        timedOut: 0,
        errors: 1,
        details: [`Failed to fetch processing inspections: ${inspectionError.message}`],
      };
    }

    // Early exit if no processing inspections
    if (!processingInspections || processingInspections.length === 0) {
      logInfo(requestId, "No processing inspections found, skipping N8N API call");
      return {
        success: true,
        processed: 0,
        timedOut: 0,
        errors: 0,
        details: ["No processing inspections to check"],
      };
    }

    logInfo(requestId, `Found ${processingInspections.length} processing inspections`);

    // 2. Only now fetch N8N executions since we have inspections to match
    const executionsResult = await fetchRecentN8nExecutions(requestId);

    if (!executionsResult.success) {
      logError(requestId, "Failed to fetch N8N executions", {
        error: executionsResult.error,
      });
      return {
        success: false,
        processed: 0,
        timedOut: 0,
        errors: 1,
        details: [`Failed to fetch N8N executions: ${executionsResult.error}`],
      };
    }

    const executions = executionsResult.executions || [];
    logInfo(requestId, `Found ${executions.length} completed N8N executions`);

    // 3. Create a map of executions by appraisal_id for quick lookup
    const executionMap = new Map(
      executions.map((exec) => [exec.appraisalId, exec])
    );

    // 4. Process each processing inspection
    const timeoutThreshold = new Date(
      Date.now() - TIMEOUT_THRESHOLD_MINUTES * 60 * 1000
    ).toISOString();

    for (const inspection of processingInspections) {
      const { id: appraisalId, user_id: userId, updated_at } = inspection;

      try {
        // Check if there's a matching N8N execution for this inspection
        const execution = executionMap.get(appraisalId);

        if (execution) {
          // Check if execution failed or succeeded
          if (execution.status === 'failed') {
            // N8N workflow failed - mark inspection as failed
            logInfo(requestId, `Processing failed execution`, {
              appraisal_id: appraisalId,
              execution_id: execution.executionId,
              error: execution.error,
            });

            const { error: updateError } = await supabase
              .from("inspections")
              .update({
                status: "failed",
                error_message: execution.error || "N8N workflow failed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", appraisalId);

            if (updateError) {
              errors++;
              details.push(
                `✗ Failed to update failed inspection ${appraisalId}: ${updateError.message}`
              );
              logError(requestId, `Failed to update failed inspection`, {
                appraisal_id: appraisalId,
                error: updateError.message,
              });
            } else {
              processed++;
              details.push(
                `✗ Marked appraisal ${appraisalId} as failed (execution ${execution.executionId})`
              );
              logInfo(requestId, `Marked inspection as failed`, {
                appraisal_id: appraisalId,
                error: execution.error,
              });
            }
          } else {
            // N8N workflow succeeded - save report and track usage
            logInfo(requestId, `Processing completed execution`, {
              appraisal_id: appraisalId,
              execution_id: execution.executionId,
              user_id: userId,
            });

            // Validate that result exists for successful executions
            if (!execution.result) {
              errors++;
              details.push(
                `✗ No result data for successful execution ${appraisalId}`
              );
              logError(requestId, `Missing result data for successful execution`, {
                appraisal_id: appraisalId,
                execution_id: execution.executionId,
              });
              continue;
            }

            // Save report and track usage
            const saveResult = await saveReportAndTrackUsage(
              appraisalId,
              userId,
              execution.result,
              requestId
            );

            if (saveResult.success) {
              processed++;
              details.push(
                `✓ Processed appraisal ${appraisalId} (execution ${execution.executionId})`
              );
              logInfo(requestId, `Successfully processed appraisal`, {
                appraisal_id: appraisalId,
              });
            } else {
              errors++;
              details.push(
                `✗ Failed to save appraisal ${appraisalId}: ${saveResult.error}`
              );
              logError(requestId, `Failed to save appraisal`, {
                appraisal_id: appraisalId,
                error: saveResult.error,
              });
            }
          }
        } else {
          // No matching execution found - check if timed out
          if (updated_at < timeoutThreshold) {
            logInfo(requestId, "Inspection timed out", {
              appraisal_id: appraisalId,
              updated_at,
            });

            const { error: updateError } = await supabase
              .from("inspections")
              .update({
                status: "failed",
                error_message: `Processing timeout after ${TIMEOUT_THRESHOLD_MINUTES} minutes`,
                updated_at: new Date().toISOString(),
              })
              .eq("id", appraisalId);

            if (updateError) {
              logError(requestId, "Failed to mark inspection as timed out", {
                inspection_id: appraisalId,
                error: updateError.message,
              });
              errors++;
              details.push(
                `✗ Failed to timeout inspection ${appraisalId}: ${updateError.message}`
              );
            } else {
              timedOut++;
              details.push(`⏱ Timed out inspection ${appraisalId}`);
              logInfo(requestId, "Marked inspection as timed out", {
                inspection_id: appraisalId,
              });
            }
          } else {
            // Still processing, not timed out yet
            logDebug(requestId, "Inspection still processing", {
              appraisal_id: appraisalId,
              updated_at,
            });
          }
        }
      } catch (error) {
        errors++;
        const message = error instanceof Error ? error.message : String(error);
        details.push(`✗ Error processing ${appraisalId}: ${message}`);
        logError(requestId, `Exception processing inspection`, {
          appraisal_id: appraisalId,
          error: message,
        });
      }
    }

    logInfo(requestId, "N8N polling cycle completed", {
      processed,
      timedOut,
      errors,
      total_inspections: processingInspections.length,
    });

    return {
      success: true,
      processed,
      timedOut,
      errors,
      details,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(requestId, "Critical error in polling cycle", {
      error: message,
    });

    return {
      success: false,
      processed,
      timedOut,
      errors: errors + 1,
      details: [...details, `Critical error: ${message}`],
    };
  }
}
