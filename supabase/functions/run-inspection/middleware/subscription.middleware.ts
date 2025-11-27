import { Request, Response, NextFunction } from "npm:express@4.18.2";
import { getHttpStatusForSubscriptionError } from "../../shared/subscription-middleware.ts";
import { supabase } from "../config/supabase.config.ts";
import { HTTP_STATUS, logError, logInfo } from "../utils/logger.ts";

/**
 * Subscription validation middleware
 * Checks if user has available reports before processing request
 * This should be used BEFORE the main processing logic
 *
 * Uses direct RPC call to with_subscription_check function
 */
export async function subscriptionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { requestId, userId } = req as { requestId: string; userId?: string };

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
    // Direct RPC call to database function
    const { data: check, error: rpcError } = await supabase.rpc("with_subscription_check", {
      p_user_id: userId,
      p_require_subscription: true, // Active subscription always required
      p_check_usage_limit: true,
      p_track_usage: false, // Don't track yet, just validate
      p_inspection_id: null,
      p_report_id: null,
      p_had_history: false,
      p_allow_block_usage: true,
    });

    if (rpcError || !check?.success) {
      const error = check?.error || rpcError?.message || "Unknown error";
      const code = check?.code || "INTERNAL_ERROR";

      logError(requestId, "Subscription check failed", {
        code,
        error,
      });

      return res.status(getHttpStatusForSubscriptionError(code)).json({
        error,
        code,
        remaining_reports: check?.remaining_reports || 0,
        subscription_reports: check?.subscription_reports || 0,
        parent_carryover: check?.parent_carryover || 0,
        block_reports: check?.block_reports || 0,
        has_active_subscription: check?.has_active_subscription || false,
      });
    }

    const { remaining_reports, subscription_reports, parent_carryover, block_reports, has_active_subscription } = check;

    logInfo(requestId, "Subscription check passed", {
      remaining_reports,
      subscription_reports,
      parent_carryover,
      block_reports,
      has_active_subscription,
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
