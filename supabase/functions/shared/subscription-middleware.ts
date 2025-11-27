/**
 * Subscription Middleware - Utility Functions
 *
 * Provides utility functions for subscription error handling.
 * All business logic is in the database RPC function: with_subscription_check()
 *
 * For subscription checks, call the RPC directly:
 * ```typescript
 * const { data, error } = await supabase.rpc("with_subscription_check", {
 *   p_user_id: userId,
 *   p_check_usage_limit: true,
 *   p_track_usage: false
 * });
 * ```
 */

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
