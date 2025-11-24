import { logInfo, logError, logDebug } from "../utils/logger.ts";
import { fetchRecentN8nExecutions } from "./n8n.service.ts";
import {
  saveReportAndTrackUsage,
  updateInspectionStatus,
} from "./report.service.ts";
import { supabase } from "../config/supabase.config.ts";

const TIMEOUT_THRESHOLD_MINUTES = 15;

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

    // 1. Fetch recent completed N8N executions
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

    // 2. Process each completed execution
    for (const execution of executions) {
      const { appraisalId, executionId, result } = execution;

      try {
        // Check if inspection exists and is still in processing state
        const { data: inspection, error } = await supabase
          .from("inspections")
          .select("id, status, user_id, created_at")
          .eq("id", appraisalId)
          .single();

        if (error || !inspection) {
          logDebug(requestId, `Inspection not found for appraisal_id`, {
            appraisal_id: appraisalId,
            execution_id: executionId,
          });
          continue;
        }

        // Skip if already processed
        if (inspection.status !== "processing") {
          logDebug(requestId, `Inspection already processed`, {
            appraisal_id: appraisalId,
            status: inspection.status,
          });
          continue;
        }

        logInfo(requestId, `Processing completed execution`, {
          appraisal_id: appraisalId,
          execution_id: executionId,
          user_id: inspection.user_id,
        });

        // Save report and track usage
        const saveResult = await saveReportAndTrackUsage(
          appraisalId,
          inspection.user_id,
          result,
          requestId
        );

        if (saveResult.success) {
          processed++;
          details.push(
            `✓ Processed appraisal ${appraisalId} (execution ${executionId})`
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
      } catch (error) {
        errors++;
        const message = error instanceof Error ? error.message : String(error);
        details.push(`✗ Error processing ${appraisalId}: ${message}`);
        logError(requestId, `Exception processing appraisal`, {
          appraisal_id: appraisalId,
          error: message,
        });
      }
    }

    // 3. Check for timed-out inspections (stuck in processing for >15 minutes)
    const timeoutThreshold = new Date(
      Date.now() - TIMEOUT_THRESHOLD_MINUTES * 60 * 1000
    ).toISOString();

    const { data: stuckInspections, error: stuckError } = await supabase
      .from("inspections")
      .select("id, user_id, created_at")
      .eq("status", "processing")
      .lt("updated_at", timeoutThreshold);

    if (stuckError) {
      logError(requestId, "Failed to fetch stuck inspections", {
        error: stuckError.message,
      });
    } else if (stuckInspections && stuckInspections.length > 0) {
      logInfo(
        requestId,
        `Found ${stuckInspections.length} timed-out inspections`
      );

      for (const inspection of stuckInspections) {
        try {
          const { error: updateError } = await supabase
            .from("inspections")
            .update({
              status: "failed",
              error_message: `Processing timeout after ${TIMEOUT_THRESHOLD_MINUTES} minutes`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", inspection.id);

          if (updateError) {
            logError(requestId, "Failed to mark inspection as timed out", {
              inspection_id: inspection.id,
              error: updateError.message,
            });
            errors++;
            details.push(
              `✗ Failed to timeout inspection ${inspection.id}: ${updateError.message}`
            );
          } else {
            timedOut++;
            details.push(`⏱ Timed out inspection ${inspection.id}`);
            logInfo(requestId, "Marked inspection as timed out", {
              inspection_id: inspection.id,
            });
          }
        } catch (error) {
          errors++;
          const message =
            error instanceof Error ? error.message : String(error);
          details.push(`✗ Error timing out ${inspection.id}: ${message}`);
          logError(requestId, "Exception timing out inspection", {
            inspection_id: inspection.id,
            error: message,
          });
        }
      }
    }

    logInfo(requestId, "N8N polling cycle completed", {
      processed,
      timedOut,
      errors,
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
