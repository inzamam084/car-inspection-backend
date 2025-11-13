import { Request, Response, NextFunction } from "npm:express@4.18.2";
import {
  withSubscriptionCheck,
  getHttpStatusForSubscriptionError,
} from "../../shared/subscription-middleware.ts";
import { HTTP_STATUS, logError, logInfo } from "../utils/logger.ts";

/**
 * Subscription validation middleware
 * Checks if user has available reports before processing request
 * This should be used BEFORE the main processing logic
 */
export async function subscriptionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { requestId, userId } = req;

  if (!userId) {
    logError(requestId, "User ID not found in request");
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      error: "Authentication required",
    });
  }

  try {
    logInfo(requestId, "Checking subscription access", {
      user_id: "[PRESENT]",
    });

    // Pre-flight check: validate subscription/block availability WITHOUT tracking
    const check = await withSubscriptionCheck(userId, {
      requireSubscription: false, // Allow report blocks
      checkUsageLimit: true,
      trackUsage: false, // Don't track yet, just validate
      allowBlockUsage: true,
    });

    if (!check.success) {
      const { code, error, remainingReports, subscriptionReports, blockReports, hasActiveSubscription } = check;
      
      logError(requestId, "Subscription check failed", {
        code,
        error,
      });

      return res.status(getHttpStatusForSubscriptionError(code)).json({
        error,
        code,
        remainingReports,
        subscriptionReports,
        blockReports,
        hasActiveSubscription,
      });
    }

    const { remainingReports, subscriptionReports, blockReports, hasActiveSubscription } = check;

    logInfo(requestId, "Subscription check passed", {
      remaining_reports: remainingReports,
      subscription_reports: subscriptionReports,
      block_reports: blockReports,
      has_active_subscription: hasActiveSubscription,
    });

    // Attach subscription info to request for later use
    (req as any).subscriptionCheck = check;

    next();
  } catch (error) {
    const { message, stack } = error as Error;
    logError(requestId, "Subscription middleware error", {
      error: message,
      stack,
    });

    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Failed to validate subscription",
    });
  }
}
