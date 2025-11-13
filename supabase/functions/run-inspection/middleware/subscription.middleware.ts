import { Request, Response, NextFunction } from "npm:express@4.18.2";
import {
  withSubscriptionCheck,
  getHttpStatusForSubscriptionError,
} from "../../shared/subscription-middleware.ts";
import { logError, logInfo } from "../utils/logger.ts";

/**
 * Subscription validation middleware
 * Checks if user has available reports before processing request
 */
export async function validateSubscription(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = (req as any).requestId;
  const userId = (req as any).userId; // Set by auth middleware

  if (!userId) {
    logError(requestId, "User ID not found in request");
    return res.status(401).json({
      error: "Authentication required",
    });
  }

  try {
    logInfo(requestId, "Checking subscription access", {
      user_id: "[PRESENT]",
    });

    // Pre-flight check: validate subscription/block availability
    const check = await withSubscriptionCheck(userId, {
      requireSubscription: false, // Allow report blocks
      checkUsageLimit: true,
      trackUsage: false, // Don't track yet
      allowBlockUsage: true,
    });

    if (!check.success) {
      logError(requestId, "Subscription check failed", {
        code: check.code,
        error: check.error,
      });

      return res.status(getHttpStatusForSubscriptionError(check.code)).json({
        error: check.error,
        code: check.code,
        remainingReports: check.remainingReports,
        subscriptionReports: check.subscriptionReports,
        blockReports: check.blockReports,
        hasActiveSubscription: check.hasActiveSubscription,
      });
    }

    logInfo(requestId, "Subscription check passed", {
      remaining_reports: check.remainingReports,
      subscription_reports: check.subscriptionReports,
      block_reports: check.blockReports,
      has_active_subscription: check.hasActiveSubscription,
    });

    // Attach subscription info to request for later use
    (req as any).subscriptionCheck = check;

    next();
  } catch (error) {
    logError(requestId, "Subscription middleware error", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    return res.status(500).json({
      error: "Failed to validate subscription",
    });
  }
}

