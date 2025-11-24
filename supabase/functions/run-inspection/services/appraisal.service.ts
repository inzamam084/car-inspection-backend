import { logInfo, logError } from "../utils/logger.ts";
import { fireN8nWebhookAsync } from "./n8n.service.ts";
import {
  updateInspectionStatus,
} from "./report.service.ts";
import type { N8nAppraisalPayload } from "../types/index.ts";

/**
 * Process appraisal in the background (fire-and-forget)
 * Fires N8N webhook and returns immediately
 * Cron job will poll N8N for results and update inspection status
 */
export async function processAppraisalInBackground(
  payload: N8nAppraisalPayload,
  userId: string,
  appraisalId: string,
  requestId: string
): Promise<void> {
  try {
    // Fire N8N webhook without waiting for response
    const fireResult = fireN8nWebhookAsync(payload, requestId);

    if (!fireResult.success) {
      logError(requestId, "Failed to fire N8N webhook", {
        error: fireResult.error,
        appraisal_id: appraisalId
      });

      // Update inspection status to failed
      await updateInspectionStatus(appraisalId, "failed", requestId);
      return;
    }

    // Update status to 'processing' - cron job will poll N8N and update when complete
    const statusResult = await updateInspectionStatus(
      appraisalId,
      "processing",
      requestId
    );

    if (!statusResult.success) {
      logError(requestId, "Failed to update inspection status to processing", {
        error: statusResult.error,
        appraisal_id: appraisalId
      });
    }

    logInfo(requestId, "N8N webhook fired successfully, processing in background", {
      appraisal_id: appraisalId,
      user_id: userId
    });

    // Exit immediately - cron job will handle the rest

  } catch (error) {
    const { message, stack } = error as Error;

    logError(requestId, "Error in background processing", {
      error: message,
      stack,
      userId,
      appraisalId,
    });

    // Mark as failed
    await updateInspectionStatus(appraisalId, "failed", requestId);
  }
}

