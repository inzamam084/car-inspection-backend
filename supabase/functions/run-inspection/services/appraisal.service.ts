import { logInfo, logError } from "../utils/logger.ts";
import { handleN8nAppraisalRequest } from "./n8n.service.ts";
import { withSubscriptionCheck } from "../../shared/subscription-middleware.ts";
import {
  saveReportToDatabase,
  updateInspectionStatus,
} from "./report.service.ts";
import type { N8nAppraisalPayload, N8nAppraisalResponse } from "../types/index.ts";

/**
 * Process appraisal in the background
 * Calls n8n webhook and tracks usage on success
 */
export async function processAppraisalInBackground(
  payload: N8nAppraisalPayload,
  userId: string,
  appraisalId: string,
  requestId: string
): Promise<void> {
  try {
    // Call n8n handler directly
    const response = await handleN8nAppraisalRequest(payload, requestId);

    logInfo(requestId, "Request processed", {
      status: response.status,
    });

    // Parse response
    const responseText = await response.text();
    let reportData: N8nAppraisalResponse | null = null;

    try {
      reportData = JSON.parse(responseText) as N8nAppraisalResponse;
    } catch (e) {
      logError(requestId, "Failed to parse response", {
        error: (e as Error).message,
      });
      
      // Update inspection status to failed
      await updateInspectionStatus(appraisalId, "failed", requestId);
      return;
    }

    // Track usage ONLY if n8n request was successful (200)
    if (response.status === 200 && reportData) {
      logInfo(requestId, "N8n request successful, saving report and tracking usage");

      // 1. Save report to database with actual n8n data
      const saveResult = await saveReportToDatabase(
        appraisalId,
        reportData,
        requestId
      );

      if (!saveResult.success) {
        logError(requestId, "Failed to save report", {
          error: saveResult.error,
        });
        
        // Update inspection status to failed if report save fails
        await updateInspectionStatus(appraisalId, "failed", requestId);
        return;
      }

      logInfo(requestId, "Report saved successfully", {
        report_id: saveResult.reportId,
      });

      // 2. Update inspection status to done
      const statusResult = await updateInspectionStatus(
        appraisalId,
        "done",
        requestId
      );

      if (!statusResult.success) {
        logError(requestId, "Failed to update inspection status", {
          error: statusResult.error,
        });
      }

      // 3. Track usage with the saved report ID
      // withSubscriptionCheck will create report_usage entry and deduct from subscription/blocks
      const usageCheck = await withSubscriptionCheck(userId, {
        requireSubscription: false,
        checkUsageLimit: true,
        trackUsage: true,
        inspectionId: appraisalId,
        reportId: saveResult.reportId, // Pass the actual report ID
        allowBlockUsage: true,
        hadHistory: false,
      });

      if (!usageCheck.success) {
        const { code, error } = usageCheck;

        logError(requestId, "Usage tracking failed", {
          code,
          error,
          report_id: saveResult.reportId,
        });

        // Log critically but don't fail the request - report is already saved
        console.error(
          `[CRITICAL] Usage tracking failed for user ${userId}, appraisal ${appraisalId}, report ${saveResult.reportId}:`,
          error
        );
      } else {
        const { usageType, remainingReports } = usageCheck;

        logInfo(requestId, "Usage tracked successfully", {
          usage_type: usageType,
          remaining_reports: remainingReports,
          report_id: saveResult.reportId,
        });
      }
    } else {
      logInfo(requestId, "N8n request failed, updating inspection status", {
        status: response.status,
      });

      // Update inspection status to failed
      await updateInspectionStatus(appraisalId, "failed", requestId);
    }

    logInfo(requestId, "Background processing completed");
  } catch (error) {
    const { message, stack } = error as Error;

    logError(requestId, "Error in background processing", {
      error: message,
      stack,
      userId,
      appraisalId,
    });
  }
}

