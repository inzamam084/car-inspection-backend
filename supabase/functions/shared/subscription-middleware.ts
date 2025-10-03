/**
 * Subscription Middleware - Updated for New Database Schema
 * 
 * Middleware for validating subscription access and tracking report usage
 * with the new billing system.
 * 
 * Key Features:
 * - Validates active subscription OR available report blocks
 * - Supports both subscription reports and pre-purchased blocks
 * - Automatic usage deduction with proper priority (subscription → blocks)
 * - Comprehensive error codes for different failure scenarios
 * 
 * Usage Example:
 * ```typescript
 * const check = await withSubscriptionCheck(userId, {
 *   requireSubscription: true,
 *   checkUsageLimit: true,
 *   trackUsage: true,
 *   inspectionId: inspectionId,
 *   reportId: reportId, // Optional
 *   hadHistory: false
 * });
 * 
 * if (!check.success) {
 *   return errorResponse(check.error, check.code);
 * }
 * ```
 */

import {
  checkSubscriptionAccess,
  recordReportUsage,
  getSubscriptionStatus,
  getUserAvailableReports,
  createPlaceholderReport,
} from "./subscription-utils.ts";

export interface SubscriptionMiddlewareOptions {
  /**
   * Whether to require an active subscription
   * If false, user can still use report blocks without active subscription
   * Default: false (allows blocks without subscription)
   */
  requireSubscription?: boolean;

  /**
   * Whether to check if user has available reports
   * Checks both subscription and block reports
   * Default: true
   */
  checkUsageLimit?: boolean;

  /**
   * Whether to track this report usage (deduct from available reports)
   * If true, requires inspectionId
   * Default: false
   */
  trackUsage?: boolean;

  /**
   * Inspection ID for usage tracking
   * Required if trackUsage is true
   */
  inspectionId?: string;

  /**
   * Report ID for usage tracking
   * Optional - if not provided, placeholder report will be created
   */
  reportId?: string;

  /**
   * Whether this report includes vehicle history lookup
   * Used for usage tracking and potential differential pricing
   * Default: false
   */
  hadHistory?: boolean;

  /**
   * Whether to allow usage from report blocks when subscription is inactive
   * Default: true
   */
  allowBlockUsage?: boolean;
}

export interface SubscriptionCheckResult {
  success: boolean;
  error?: string;
  code?:
    | "USER_ID_REQUIRED"
    | "SUBSCRIPTION_REQUIRED"
    | "SUBSCRIPTION_INACTIVE"
    | "USAGE_LIMIT_EXCEEDED"
    | "NO_REPORTS_AVAILABLE"
    | "INSPECTION_ID_REQUIRED"
    | "USAGE_TRACKING_FAILED"
    | "REPORT_CREATION_FAILED"
    | "DUPLICATE_USAGE"
    | "INTERNAL_ERROR";

  // Available reports info
  remainingReports?: number;
  subscriptionReports?: number;
  blockReports?: number;
  totalAvailableReports?: number;

  // Usage tracking info
  usageType?: "subscription_included" | "block" | "insufficient";
  usageTracked?: boolean;
  reportId?: string;

  // Subscription info
  hasActiveSubscription?: boolean;
  subscriptionStatus?: "active" | "past_due" | "canceled" | "trialing" | "none";
  willCancelAtPeriodEnd?: boolean;
  daysUntilRenewal?: number;

  // Plan info
  planName?: string;
  planIncludedReports?: number;

  // Context
  userId?: string;
}

/**
 * Main subscription middleware function
 * Validates subscription access and optionally tracks usage
 */
export async function withSubscriptionCheck(
  userId: string,
  options: SubscriptionMiddlewareOptions = {}
): Promise<SubscriptionCheckResult> {
  const {
    requireSubscription = false,
    checkUsageLimit = true,
    trackUsage = false,
    inspectionId,
    reportId,
    hadHistory = false,
    allowBlockUsage = true,
  } = options;

  try {
    // Validate user ID
    if (!userId) {
      return {
        success: false,
        error: "User ID is required",
        code: "USER_ID_REQUIRED",
      };
    }

    // Get subscription status
    const status = await getSubscriptionStatus(userId);

    // Check if subscription is required
    if (requireSubscription && !status.isActive) {
      return {
        success: false,
        error: "Active subscription required",
        code: "SUBSCRIPTION_REQUIRED",
        hasActiveSubscription: false,
        subscriptionStatus: status.subscription?.status || "none",
        userId,
      };
    }

    // Get available reports (subscription + blocks)
    const available = await getUserAvailableReports(userId);

    // Get full access details for comprehensive response
    const accessCheck = await checkSubscriptionAccess(userId);

    // Check usage limit if requested
    if (checkUsageLimit) {
      const hasReports = allowBlockUsage
        ? available.total_available > 0
        : available.subscription_available > 0;

      if (!hasReports) {
        return {
          success: false,
          error: allowBlockUsage
            ? "No reports available. Please purchase more reports or upgrade your subscription."
            : "No subscription reports available. Report blocks not allowed in this context.",
          code: "NO_REPORTS_AVAILABLE",
          remainingReports: available.total_available,
          subscriptionReports: available.subscription_available,
          blockReports: available.blocks_available,
          hasActiveSubscription: status.isActive,
          subscriptionStatus: status.subscription?.status || "none",
          planName: accessCheck.plan?.name,
          planIncludedReports: accessCheck.plan?.included_reports,
          userId,
        };
      }
    }

    // Track usage if requested
    let usageResult:
      | {
          success: boolean;
          usage_type: string;
          message: string;
          remaining_reports: number;
        }
      | undefined;

    if (trackUsage) {
      // Validate inspection ID for usage tracking
      if (!inspectionId) {
        return {
          success: false,
          error: "Inspection ID is required for usage tracking",
          code: "INSPECTION_ID_REQUIRED",
          userId,
        };
      }

      // Get or create report ID
      let finalReportId = reportId;
      if (!finalReportId) {
        finalReportId = await createPlaceholderReport(inspectionId);
        if (!finalReportId) {
          return {
            success: false,
            error: "Failed to create report for usage tracking",
            code: "REPORT_CREATION_FAILED",
            userId,
          };
        }
      }

      // Record the usage
      usageResult = await recordReportUsage(
        userId,
        inspectionId,
        finalReportId,
        hadHistory
      );

      if (!usageResult.success) {
        // Handle specific usage tracking failures
        if (usageResult.usage_type === "duplicate") {
          return {
            success: false,
            error: usageResult.message,
            code: "DUPLICATE_USAGE",
            userId,
          };
        }

        return {
          success: false,
          error: usageResult.message || "Failed to track report usage",
          code: "USAGE_TRACKING_FAILED",
          remainingReports: usageResult.remaining_reports,
          userId,
        };
      }
    }

    // Build successful response with all relevant information
    return {
      success: true,
      remainingReports: usageResult
        ? usageResult.remaining_reports
        : available.total_available,
      subscriptionReports: available.subscription_available,
      blockReports: available.blocks_available,
      totalAvailableReports: available.total_available,
      usageType: usageResult?.usage_type as any,
      usageTracked: trackUsage,
      reportId: reportId,
      hasActiveSubscription: status.isActive,
      subscriptionStatus: status.subscription?.status || "none",
      willCancelAtPeriodEnd: status.willCancelAtPeriodEnd,
      daysUntilRenewal: status.daysUntilRenewal,
      planName: accessCheck.plan?.name,
      planIncludedReports: accessCheck.plan?.included_reports,
      userId,
    };
  } catch (error) {
    console.error("Subscription middleware error:", error);
    return {
      success: false,
      error: "Internal server error during subscription check",
      code: "INTERNAL_ERROR",
      userId,
    };
  }
}

/**
 * Quick check if user can create a report
 * Simplified version that only returns boolean
 */
export async function canUserCreateReport(userId: string): Promise<boolean> {
  const result = await withSubscriptionCheck(userId, {
    requireSubscription: false,
    checkUsageLimit: true,
    trackUsage: false,
    allowBlockUsage: true,
  });

  return result.success;
}

/**
 * Check subscription and track usage in one call
 * Convenience function for common use case
 */
export async function checkAndTrackUsage(
  userId: string,
  inspectionId: string,
  reportId?: string,
  hadHistory: boolean = false
): Promise<SubscriptionCheckResult> {
  return await withSubscriptionCheck(userId, {
    requireSubscription: false, // Allow blocks
    checkUsageLimit: true,
    trackUsage: true,
    inspectionId,
    reportId,
    hadHistory,
    allowBlockUsage: true,
  });
}

/**
 * Validate subscription without tracking usage
 * Used for pre-flight checks before starting report generation
 */
export async function validateSubscriptionAccess(
  userId: string,
  requireActiveSubscription: boolean = false
): Promise<SubscriptionCheckResult> {
  return await withSubscriptionCheck(userId, {
    requireSubscription: requireActiveSubscription,
    checkUsageLimit: true,
    trackUsage: false,
    allowBlockUsage: true,
  });
}

/**
 * Get detailed subscription information for display
 */
export async function getSubscriptionDetails(userId: string): Promise<{
  hasSubscription: boolean;
  subscriptionStatus: string;
  planName?: string;
  subscriptionReports: number;
  blockReports: number;
  totalAvailableReports: number;
  daysUntilRenewal?: number;
  willCancelAtPeriodEnd?: boolean;
  activeBlocks: Array<{
    id: string;
    reports_remaining: number;
    expiry_date: string;
    with_history: boolean;
  }>;
}> {
  const check = await withSubscriptionCheck(userId, {
    requireSubscription: false,
    checkUsageLimit: false,
    trackUsage: false,
  });

  const available = await getUserAvailableReports(userId);

  return {
    hasSubscription: check.hasActiveSubscription || false,
    subscriptionStatus: check.subscriptionStatus || "none",
    planName: check.planName,
    subscriptionReports: check.subscriptionReports || 0,
    blockReports: check.blockReports || 0,
    totalAvailableReports: check.totalAvailableReports || 0,
    daysUntilRenewal: check.daysUntilRenewal,
    willCancelAtPeriodEnd: check.willCancelAtPeriodEnd,
    activeBlocks: available.active_blocks || [],
  };
}

/**
 * Map subscription check error codes to HTTP status codes
 * Used in HTTP response handlers
 */
export function getHttpStatusForSubscriptionError(
  code?: string
): number {
  switch (code) {
    case "SUBSCRIPTION_REQUIRED":
    case "NO_REPORTS_AVAILABLE":
    case "USAGE_LIMIT_EXCEEDED":
      return 402; // Payment Required
    case "USER_ID_REQUIRED":
    case "INSPECTION_ID_REQUIRED":
      return 400; // Bad Request
    case "DUPLICATE_USAGE":
      return 409; // Conflict
    case "SUBSCRIPTION_INACTIVE":
      return 403; // Forbidden
    case "USAGE_TRACKING_FAILED":
    case "REPORT_CREATION_FAILED":
    case "INTERNAL_ERROR":
    default:
      return 500; // Internal Server Error
  }
}

/**
 * Format subscription error for user-friendly display
 */
export function formatSubscriptionError(result: SubscriptionCheckResult): string {
  if (result.success) {
    return "";
  }

  // Provide helpful error messages based on error code
  switch (result.code) {
    case "SUBSCRIPTION_REQUIRED":
      return "An active subscription is required to use this feature. Please subscribe to continue.";
    
    case "NO_REPORTS_AVAILABLE":
      if (result.hasActiveSubscription) {
        return `You've used all your monthly reports (${result.planIncludedReports} included). Purchase additional reports or wait until your subscription renews in ${result.daysUntilRenewal} days.`;
      }
      return "No reports available. Please purchase a subscription or report blocks to continue.";
    
    case "USAGE_LIMIT_EXCEEDED":
      return `Report limit reached. You have ${result.remainingReports} reports remaining.`;
    
    case "DUPLICATE_USAGE":
      return "This report has already been counted toward your usage.";
    
    case "SUBSCRIPTION_INACTIVE":
      return "Your subscription is not active. Please update your payment information or reactivate your subscription.";
    
    default:
      return result.error || "An error occurred while checking your subscription.";
  }
}
