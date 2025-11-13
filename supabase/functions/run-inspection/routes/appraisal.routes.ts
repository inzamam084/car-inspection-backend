import { Router, Request, Response } from "npm:express@4.18.2";
import { HTTP_STATUS, logInfo, logError, logDebug } from "../utils/logger.ts";
import { routeRequest } from "../services/n8n.service.ts";
import { authMiddleware } from "../middleware/auth.middleware.ts";
import {
  withSubscriptionCheck,
  getHttpStatusForSubscriptionError,
} from "../../shared/subscription-middleware.ts";

const router = Router();

/**
 * Main appraisal endpoint
 * POST /run-inspection
 * 
 * Requires: JWT authentication
 * Validates: Subscription/report availability
 * Tracks: Report usage on success
 */
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  const requestId = (req as any).requestId;
  const userId = (req as any).userId; // Set by authMiddleware

  try {
    // 1. Validate Request Body
    logDebug(requestId, "Validating request body");
    const payload = req.body;

    if (!payload || typeof payload !== "object") {
      logError(requestId, "Invalid request body");
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Invalid request body. Expected JSON object.",
      });
    }

    logDebug(requestId, "Request body validated", {
      has_vin: "vin" in payload,
      has_image_urls: "image_urls" in payload,
      has_appraisal_id: "appraisal_id" in payload,
    });

    // 2. Check Subscription and Validate Usage Limit
    logInfo(requestId, "Checking subscription access");
    
    const appraisalId = payload.appraisal_id;
    
    // Pre-flight check: validate subscription/block availability WITHOUT tracking
    const preCheck = await withSubscriptionCheck(userId, {
      requireSubscription: false, // Allow report blocks
      checkUsageLimit: true,
      trackUsage: false, // Don't track yet, just validate
      allowBlockUsage: true,
    });

    if (!preCheck.success) {
      logError(requestId, "Subscription check failed", {
        code: preCheck.code,
        error: preCheck.error,
      });

      return res
        .status(getHttpStatusForSubscriptionError(preCheck.code))
        .json({
          error: preCheck.error,
          code: preCheck.code,
          remainingReports: preCheck.remainingReports,
          subscriptionReports: preCheck.subscriptionReports,
          blockReports: preCheck.blockReports,
          hasActiveSubscription: preCheck.hasActiveSubscription,
        });
    }

    logInfo(requestId, "Subscription check passed", {
      remaining_reports: preCheck.remainingReports,
      subscription_reports: preCheck.subscriptionReports,
      block_reports: preCheck.blockReports,
      has_active_subscription: preCheck.hasActiveSubscription,
    });

    // 3. Route to n8n handler
    logInfo(requestId, "Processing n8n appraisal request");
    const response = await routeRequest(
      payload as Record<string, unknown>,
      requestId
    );

    logInfo(requestId, "Request processed successfully", {
      status: response.status,
    });

    // 4. Parse response
    const responseText = await response.text();
    let responseData;

    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      logError(requestId, "Failed to parse response", {
        error: (e as Error).message,
      });
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error.",
      });
    }

    // 5. Track usage ONLY if n8n request was successful (200)
    if (response.status === 200) {
      logInfo(requestId, "N8n request successful, tracking usage");

      // Track usage now that report generation is confirmed
      const usageCheck = await withSubscriptionCheck(userId, {
        requireSubscription: false,
        checkUsageLimit: true,
        trackUsage: true, // Track now!
        inspectionId: appraisalId,
        allowBlockUsage: true,
        hadHistory: false, // Adjust based on your needs
      });

      if (!usageCheck.success) {
        logError(requestId, "Usage tracking failed", {
          code: usageCheck.code,
          error: usageCheck.error,
        });

        // Don't fail the request if usage tracking fails
        // But log it prominently for investigation
        console.error(
          `[CRITICAL] Usage tracking failed for user ${userId}, appraisal ${appraisalId}:`,
          usageCheck.error
        );

        // Optionally, you could return an error here if usage tracking is critical
        // For now, we'll continue and return the successful result
      } else {
        logInfo(requestId, "Usage tracked successfully", {
          usage_type: usageCheck.usageType,
          remaining_reports: usageCheck.remainingReports,
        });

        // Add usage information to response
        responseData.usage = {
          type: usageCheck.usageType,
          remaining_reports: usageCheck.remainingReports,
          subscription_reports: usageCheck.subscriptionReports,
          block_reports: usageCheck.blockReports,
        };
      }
    } else {
      logInfo(requestId, "N8n request failed, skipping usage tracking", {
        status: response.status,
      });
    }

    // 6. Return final response
    return res.status(response.status).json(responseData);
  } catch (error) {
    logError(requestId, "Unhandled error in request pipeline", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    // Respond to known parsing/validation errors with 400
    if (
      (error as Error).message.includes("Request body") ||
      (error as Error).message.includes("Invalid JSON")
    ) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: (error as Error).message,
      });
    }

    // Generic fallback for all other unexpected errors
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Internal server error.",
    });
  }
});

export default router;
