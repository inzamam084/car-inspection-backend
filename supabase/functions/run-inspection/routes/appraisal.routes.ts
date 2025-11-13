import { Router, Request, Response } from "npm:express@4.18.2";
import { HTTP_STATUS, logInfo, logError, logDebug } from "../utils/logger.ts";
import { routeRequest } from "../services/n8n.service.ts";
import { authMiddleware } from "../middleware/auth.middleware.ts";
import { subscriptionMiddleware } from "../middleware/subscription.middleware.ts";
import { withSubscriptionCheck } from "../../shared/subscription-middleware.ts";

const router = Router();

/**
 * Main appraisal endpoint
 * POST /run-inspection
 *
 * Requires: JWT authentication
 * Validates: Subscription/report availability
 * Tracks: Report usage on success
 */
router.post(
  "/",
  authMiddleware, // 1. Authenticate user
  subscriptionMiddleware, // 2. Validate subscription/report availability
  async (req: Request, res: Response) => {
    const { requestId, userId } = req; // Set by logging and auth middleware

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

      const appraisalId = payload.appraisal_id;

      // 2. Route to n8n handler
      logInfo(requestId, "Processing n8n appraisal request");
      const response = await routeRequest(
        payload as Record<string, unknown>,
        requestId
      );

      logInfo(requestId, "Request processed", {
        status: response.status,
      });

      // 3. Parse response
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

      // 4. Track usage ONLY if n8n request was successful (200)
      if (response.status === 200) {
        logInfo(requestId, "N8n request successful, tracking usage");

        // Track usage now that operation is confirmed successful
        const usageCheck = await withSubscriptionCheck(userId, {
          requireSubscription: false,
          checkUsageLimit: true,
          trackUsage: true, // Track now!
          inspectionId: appraisalId,
          allowBlockUsage: true,
          hadHistory: false,
        });

        if (!usageCheck.success) {
          const { code, error } = usageCheck;
          
          logError(requestId, "Usage tracking failed", {
            code,
            error,
          });

          // Log critically but don't fail the request
          // The user got their report, we just couldn't track it properly
          console.error(
            `[CRITICAL] Usage tracking failed for user ${userId}, appraisal ${appraisalId}:`,
            error
          );
        } else {
          const { usageType, remainingReports, subscriptionReports, blockReports } = usageCheck;
          
          logInfo(requestId, "Usage tracked successfully", {
            usage_type: usageType,
            remaining_reports: remainingReports,
          });

          // Add usage information to response
          responseData.usage = {
            type: usageType,
            remaining_reports: remainingReports,
            subscription_reports: subscriptionReports,
            block_reports: blockReports,
          };
        }
      } else {
        logInfo(requestId, "N8n request failed, skipping usage tracking", {
          status: response.status,
        });
      }

      // 5. Return final response
      return res.status(response.status).json(responseData);
    } catch (error) {
      const { message, stack } = error as Error;
      
      logError(requestId, "Unhandled error in request pipeline", {
        error: message,
        stack,
      });

      // Respond to known parsing/validation errors with 400
      if (message.includes("Request body") || message.includes("Invalid JSON")) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: message,
        });
      }

      // Generic fallback for all other unexpected errors
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error.",
      });
    }
  }
);

export default router;
