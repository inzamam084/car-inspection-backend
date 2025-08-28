import {
  checkSubscriptionAccess,
  incrementUsage,
} from "./subscription-utils.ts";

export interface SubscriptionMiddlewareOptions {
  requireSubscription?: boolean;
  checkUsageLimit?: boolean;
  incrementUsage?: boolean;
}

export interface SubscriptionCheckResult {
  success: boolean;
  error?: string;
  code?: string;
  remainingReports?: number;
  userId?: string;
}

export async function withSubscriptionCheck(
  userId: string,
  options: SubscriptionMiddlewareOptions = {}
): Promise<SubscriptionCheckResult> {
  const {
    requireSubscription = true,
    checkUsageLimit = true,
    incrementUsage: shouldIncrementUsage = false,
  } = options;

  try {
    if (!userId) {
      return {
        success: false,
        error: "User ID is required",
        code: "USER_ID_REQUIRED",
      };
    }

    // Check subscription access
    const accessCheck = await checkSubscriptionAccess(userId);

    if (requireSubscription && !accessCheck.hasAccess) {
      return {
        success: false,
        error: "Active subscription required",
        code: "SUBSCRIPTION_REQUIRED",
      };
    }

    if (checkUsageLimit && !accessCheck.canCreateReport) {
      return {
        success: false,
        error: "Usage limit exceeded",
        code: "USAGE_LIMIT_EXCEEDED",
        remainingReports: accessCheck.remainingReports,
      };
    }

    // Increment usage if requested
    if (shouldIncrementUsage && accessCheck.subscription) {
      const usageResult = await incrementUsage(userId, 1);
      if (!usageResult.success) {
        return {
          success: false,
          error: usageResult.error || "Failed to increment usage",
          code: "USAGE_INCREMENT_FAILED",
        };
      }
    }

    return {
      success: true,
      remainingReports: accessCheck.remainingReports,
      userId,
    };
  } catch (error) {
    console.error("Subscription middleware error:", error);
    return {
      success: false,
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    };
  }
}
