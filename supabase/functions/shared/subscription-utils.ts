/**
 * Subscription Utilities - Updated for New Database Schema
 * 
 * This module provides utilities for checking subscription access and managing
 * report usage with the new billing system that includes:
 * - Subscription-based reports (resets monthly)
 * - Pre-purchased report blocks (90-day expiry, FIFO usage)
 * - Proper usage tracking in report_usage table
 * 
 * Key Changes:
 * - Plans now loaded from database instead of hardcoded
 * - Usage deduction follows priority: subscription → blocks → pay-per-report
 * - Blocks expire 90 days from purchase and use FIFO ordering
 * - Usage tracked per report for auditing and billing
 * - Direct Supabase queries instead of RPC functions
 */

import {
  type Subscription,
  type Plan,
  type SubscriptionAccessCheck,
  type AvailableReportsResult,
  type RecordUsageResult,
  type SubscriptionStatus,
  type PlanWithFeatures,
  type ReportBlock,
  type SubscriptionUsageSummary,
} from "./subscription-types.ts";
import { createDatabaseService } from "./database-service.ts";

// Initialize database service with service role key for subscription operations
const dbService = createDatabaseService();
const supabase = dbService.getClient();

/**
 * Get all active plans from database with their features
 */
export async function getActivePlans(): Promise<PlanWithFeatures[]> {
  try {
    const { data: plans, error: plansError } = await supabase
      .from("plans")
      .select(`
        *,
        features:plan_features(
          id,
          plan_id,
          feature,
          position,
          created_at,
          updated_at
        )
      `)
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (plansError) {
      console.error("Error fetching plans:", plansError);
      return [];
    }

    return plans as PlanWithFeatures[];
  } catch (error) {
    console.error("Error getting active plans:", error);
    return [];
  }
}

/**
 * Get a specific plan by ID
 */
export async function getPlanById(planId: string): Promise<Plan | null> {
  try {
    const { data: plan, error } = await supabase
      .from("plans")
      .select("*")
      .eq("id", planId)
      .single();

    if (error) {
      console.error("Error fetching plan:", error);
      return null;
    }

    return plan as Plan;
  } catch (error) {
    console.error("Error getting plan by ID:", error);
    return null;
  }
}

/**
 * Get user's subscription status
 */
export async function getSubscriptionStatus(
  userId: string
): Promise<SubscriptionStatus> {
  try {
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["active", "past_due", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !subscription) {
      return {
        isActive: false,
        isPastDue: false,
        isCanceled: false,
        willCancelAtPeriodEnd: false,
        daysUntilRenewal: 0,
      };
    }

    const now = new Date();
    const periodEnd = new Date(subscription.current_period_end);
    const daysUntilRenewal = Math.ceil(
      (periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      isActive: subscription.status === "active",
      isPastDue: subscription.status === "past_due",
      isCanceled: subscription.status === "canceled",
      willCancelAtPeriodEnd: subscription.cancel_at_period_end || false,
      daysUntilRenewal,
      subscription: subscription as Subscription,
    };
  } catch (error) {
    console.error("Error getting subscription status:", error);
    return {
      isActive: false,
      isPastDue: false,
      isCanceled: false,
      willCancelAtPeriodEnd: false,
      daysUntilRenewal: 0,
    };
  }
}

/**
 * Check user's available reports across subscription and blocks
 * Direct Supabase implementation without RPC
 */
export async function getUserAvailableReports(
  userId: string
): Promise<AvailableReportsResult> {
  try {
    let subscriptionAvailable = 0;
    let blocksAvailable = 0;
    let activeSubscriptionId: string | null = null;
    let activeBlocks: any[] = [];

    // Step 1: Get active subscription with plan details
    const { data: subscriptionData, error: subError } = await supabase
      .from("subscriptions")
      .select(`
        id,
        current_period_start,
        current_period_end,
        plan:plans!inner(included_reports)
      `)
      .eq("user_id", userId)
      .eq("status", "active")
      .gte("current_period_end", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!subError && subscriptionData) {
      activeSubscriptionId = subscriptionData.id;
      const reportsIncluded = subscriptionData.plan.included_reports;
      const billingPeriodStart = new Date(subscriptionData.current_period_start)
        .toISOString()
        .split("T")[0];
      const billingPeriodEnd = new Date(subscriptionData.current_period_end)
        .toISOString()
        .split("T")[0];

      // Get usage summary for current period
      const { data: usageSummary, error: summaryError } = await supabase
        .from("subscription_usage_summary")
        .select("reports_used")
        .eq("subscription_id", activeSubscriptionId)
        .eq("billing_period_start", billingPeriodStart)
        .eq("billing_period_end", billingPeriodEnd)
        .single();

      const reportsUsed = usageSummary?.reports_used || 0;
      subscriptionAvailable = Math.max(0, reportsIncluded - reportsUsed);
    }

    // Step 2: Get active report blocks
    const { data: blocks, error: blocksError } = await supabase
      .from("report_blocks")
      .select(`
        id,
        reports_total,
        reports_used,
        expiry_date,
        report_block_type:report_block_types!inner(with_history)
      `)
      .eq("user_id", userId)
      .eq("is_active", true)
      .lt("reports_used", supabase.raw("reports_total"))
      .gt("expiry_date", new Date().toISOString())
      .order("expiry_date", { ascending: true }); // FIFO ordering

    if (!blocksError && blocks && blocks.length > 0) {
      // Calculate total blocks available
      blocksAvailable = blocks.reduce(
        (sum, block) => sum + (block.reports_total - block.reports_used),
        0
      );

      // Build active blocks array with remaining reports
      activeBlocks = blocks
        .filter((block) => block.reports_total - block.reports_used > 0)
        .map((block) => ({
          id: block.id,
          reports_remaining: block.reports_total - block.reports_used,
          expiry_date: block.expiry_date,
          with_history: block.report_block_type.with_history,
        }));
    }

    // Step 3: Return combined results
    return {
      total_available: subscriptionAvailable + blocksAvailable,
      subscription_available: subscriptionAvailable,
      blocks_available: blocksAvailable,
      active_subscription_id: activeSubscriptionId,
      active_blocks: activeBlocks,
    };
  } catch (error) {
    console.error("Error checking available reports:", error);
    return {
      total_available: 0,
      subscription_available: 0,
      blocks_available: 0,
      active_subscription_id: null,
      active_blocks: [],
    };
  }
}

/**
 * Main subscription access check function
 * Provides comprehensive information about user's report access
 */
export async function checkSubscriptionAccess(
  userId: string
): Promise<SubscriptionAccessCheck> {
  try {
    // Get subscription status
    const status = await getSubscriptionStatus(userId);

    // Get available reports (subscription + blocks)
    const available = await getUserAvailableReports(userId);

    // Get plan details if subscription exists
    let plan: Plan | null = null;
    let usageSummary: SubscriptionUsageSummary | null = null;

    if (status.subscription) {
      plan = await getPlanById(status.subscription.plan_id);

      // Get current billing period usage
      const { data: summary, error: summaryError } = await supabase
        .from("subscription_usage_summary")
        .select("*")
        .eq("subscription_id", status.subscription.id)
        .lte("billing_period_start", new Date().toISOString().split("T")[0])
        .gte("billing_period_end", new Date().toISOString().split("T")[0])
        .single();

      if (!summaryError && summary) {
        usageSummary = summary as SubscriptionUsageSummary;
      }
    }

    const hasAccess = status.isActive || available.blocks_available > 0;
    const canCreateReport = available.total_available > 0;

    return {
      hasAccess,
      canCreateReport,
      subscriptionReports: available.subscription_available,
      subscriptionIncluded: plan?.included_reports || 0,
      subscriptionUsed: usageSummary?.reports_used || 0,
      blockReports: available.blocks_available,
      activeBlocks: available.active_blocks,
      totalAvailableReports: available.total_available,
      subscription: status.subscription,
      plan: plan || undefined,
      usageSummary: usageSummary || undefined,
      billingPeriodStart: usageSummary?.billing_period_start,
      billingPeriodEnd: usageSummary?.billing_period_end,
    };
  } catch (error) {
    console.error("Error checking subscription access:", error);
    return {
      hasAccess: false,
      canCreateReport: false,
      subscriptionReports: 0,
      subscriptionIncluded: 0,
      subscriptionUsed: 0,
      blockReports: 0,
      activeBlocks: [],
      totalAvailableReports: 0,
    };
  }
}

/**
 * Record report usage - Direct Supabase implementation of the RPC logic
 * 
 * This function:
 * 1. Checks if report already tracked (prevent duplicates)
 * 2. Tries to deduct from active subscription first
 * 3. Falls back to oldest expiring report block (FIFO)
 * 4. Creates report_usage record with proper tracking
 * 5. Updates usage counters (subscription_usage_summary or report_blocks)
 * 
 * Deduction priority: subscription → blocks (FIFO by expiry) → fail
 * 
 * @param userId - User creating the report
 * @param inspectionId - Inspection being reported
 * @param reportId - Report ID (must already exist)
 * @param hadHistory - Whether vehicle history lookup was used
 * @returns Result with success status and remaining reports
 */
export async function recordReportUsage(
  userId: string,
  inspectionId: string,
  reportId: string,
  hadHistory: boolean = false
): Promise<RecordUsageResult> {
  try {
    // Step 1: Check if report already tracked (prevent duplicates)
    const { data: existingUsage, error: checkError } = await supabase
      .from("report_usage")
      .select("id")
      .eq("report_id", reportId)
      .single();

    if (existingUsage) {
      return {
        success: false,
        usage_type: "duplicate",
        message: "Report already tracked",
        remaining_reports: 0,
      };
    }

    // Step 2: Try to get active subscription
    const { data: subscriptionData, error: subError } = await supabase
      .from("subscriptions")
      .select(`
        id,
        current_period_start,
        current_period_end,
        plan:plans(included_reports)
      `)
      .eq("user_id", userId)
      .eq("status", "active")
      .gte("current_period_end", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Step 3: If active subscription exists, try to use it
    if (!subError && subscriptionData) {
      const subscriptionId = subscriptionData.id;
      const billingPeriodStart = new Date(subscriptionData.current_period_start)
        .toISOString()
        .split("T")[0];
      const billingPeriodEnd = new Date(subscriptionData.current_period_end)
        .toISOString()
        .split("T")[0];
      const reportsIncluded = subscriptionData.plan.included_reports;

      // Get or create usage summary for current period
      const { data: usageSummary, error: summaryError } = await supabase
        .from("subscription_usage_summary")
        .select("*")
        .eq("subscription_id", subscriptionId)
        .eq("billing_period_start", billingPeriodStart)
        .eq("billing_period_end", billingPeriodEnd)
        .single();

      let reportsUsed = 0;

      if (summaryError) {
        // Create new summary if doesn't exist
        const { error: insertError } = await supabase
          .from("subscription_usage_summary")
          .insert({
            subscription_id: subscriptionId,
            billing_period_start: billingPeriodStart,
            billing_period_end: billingPeriodEnd,
            reports_included: reportsIncluded,
            reports_used: 0,
          });

        if (insertError) {
          console.error("Error creating usage summary:", insertError);
        }
      } else {
        reportsUsed = usageSummary.reports_used;
      }

      const subscriptionAvailable = reportsIncluded - reportsUsed;

      // If subscription has available reports, use it
      if (subscriptionAvailable > 0) {
        // Update subscription usage
        const { error: updateError } = await supabase
          .from("subscription_usage_summary")
          .update({
            reports_used: reportsUsed + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("subscription_id", subscriptionId)
          .eq("billing_period_start", billingPeriodStart)
          .eq("billing_period_end", billingPeriodEnd);

        if (updateError) {
          console.error("Error updating subscription usage:", updateError);
          // Continue anyway - usage record is more important
        }

        // Record usage
        const { error: usageError } = await supabase
          .from("report_usage")
          .insert({
            user_id: userId,
            inspection_id: inspectionId,
            report_id: reportId,
            usage_type: "subscription_included",
            subscription_id: subscriptionId,
            had_history: hadHistory,
            billing_period_start: billingPeriodStart,
            billing_period_end: billingPeriodEnd,
            usage_date: new Date().toISOString(),
          });

        if (usageError) {
          console.error("Error recording usage:", usageError);
          return {
            success: false,
            usage_type: "insufficient",
            message: `Failed to record usage: ${usageError.message}`,
            remaining_reports: 0,
          };
        }

        return {
          success: true,
          usage_type: "subscription_included",
          message: "Report deducted from subscription",
          remaining_reports: subscriptionAvailable - 1,
        };
      }
    }

    // Step 4: Try to use report block (oldest expiring first - FIFO)
    const { data: reportBlock, error: blockError } = await supabase
      .from("report_blocks")
      .select(`
        id,
        reports_total,
        reports_used,
        report_block_type:report_block_types(with_history)
      `)
      .eq("user_id", userId)
      .eq("is_active", true)
      .lt("reports_used", supabase.raw("reports_total"))
      .gt("expiry_date", new Date().toISOString())
      .order("expiry_date", { ascending: true }) // FIFO - oldest expiring first
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (!blockError && reportBlock) {
      // Check if block supports history if needed
      const blockSupportsHistory = reportBlock.report_block_type.with_history;
      if (hadHistory && !blockSupportsHistory) {
        // This block doesn't support history, but user needs it
        // Try to find another block or fail
        const { data: historyBlock, error: historyBlockError } = await supabase
          .from("report_blocks")
          .select(`
            id,
            reports_total,
            reports_used,
            report_block_type:report_block_types(with_history)
          `)
          .eq("user_id", userId)
          .eq("is_active", true)
          .lt("reports_used", supabase.raw("reports_total"))
          .gt("expiry_date", new Date().toISOString())
          .eq("report_block_types.with_history", true)
          .order("expiry_date", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(1)
          .single();

        if (historyBlockError || !historyBlock) {
          return {
            success: false,
            usage_type: "insufficient",
            message: "No available report blocks with history support",
            remaining_reports: 0,
          };
        }

        // Use the history-enabled block instead
        const blockId = historyBlock.id;

        // Update block usage
        const { error: updateBlockError } = await supabase
          .from("report_blocks")
          .update({
            reports_used: historyBlock.reports_used + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", blockId);

        if (updateBlockError) {
          console.error("Error updating block usage:", updateBlockError);
        }

        // Record usage
        const { error: usageError } = await supabase
          .from("report_usage")
          .insert({
            user_id: userId,
            inspection_id: inspectionId,
            report_id: reportId,
            usage_type: "block",
            report_block_id: blockId,
            had_history: hadHistory,
            usage_date: new Date().toISOString(),
          });

        if (usageError) {
          console.error("Error recording block usage:", usageError);
          return {
            success: false,
            usage_type: "insufficient",
            message: `Failed to record usage: ${usageError.message}`,
            remaining_reports: 0,
          };
        }

        // Calculate remaining from all blocks
        const { data: remainingData } = await supabase
          .from("report_blocks")
          .select("reports_total, reports_used")
          .eq("user_id", userId)
          .eq("is_active", true)
          .lt("reports_used", supabase.raw("reports_total"))
          .gt("expiry_date", new Date().toISOString());

        const remaining = remainingData
          ? remainingData.reduce(
              (sum: any, block: any) =>
                sum + (block.reports_total - block.reports_used),
              0
            )
          : 0;

        return {
          success: true,
          usage_type: "block",
          message: "Report deducted from block",
          remaining_reports: remaining,
        };
      }

      // Use the first available block (supports all report types or matches history requirement)
      const blockId = reportBlock.id;

      // Update block usage
      const { error: updateBlockError } = await supabase
        .from("report_blocks")
        .update({
          reports_used: reportBlock.reports_used + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", blockId);

      if (updateBlockError) {
        console.error("Error updating block usage:", updateBlockError);
      }

      // Record usage
      const { error: usageError } = await supabase.from("report_usage").insert({
        user_id: userId,
        inspection_id: inspectionId,
        report_id: reportId,
        usage_type: "block",
        report_block_id: blockId,
        had_history: hadHistory,
        usage_date: new Date().toISOString(),
      });

      if (usageError) {
        console.error("Error recording block usage:", usageError);
        return {
          success: false,
          usage_type: "insufficient",
          message: `Failed to record usage: ${usageError.message}`,
          remaining_reports: 0,
        };
      }

      // Calculate remaining from all blocks
      const { data: remainingData } = await supabase
        .from("report_blocks")
        .select("reports_total, reports_used")
        .eq("user_id", userId)
        .eq("is_active", true)
        .lt("reports_used", supabase.raw("reports_total"))
        .gt("expiry_date", new Date().toISOString());

      const remaining = remainingData
        ? remainingData.reduce(
            (sum: any, block: any) =>
              sum + (block.reports_total - block.reports_used),
            0
          )
        : 0;

      return {
        success: true,
        usage_type: "block",
        message: "Report deducted from block",
        remaining_reports: remaining,
      };
    }

    // Step 5: No available reports
    return {
      success: false,
      usage_type: "insufficient",
      message: "No available reports. Please purchase more.",
      remaining_reports: 0,
    };
  } catch (error) {
    console.error("Error recording report usage:", error);
    return {
      success: false,
      usage_type: "insufficient",
      message: (error as Error).message,
      remaining_reports: 0,
    };
  }
}

/**
 * Get active report blocks for a user
 * Useful for displaying available blocks to user
 */
export async function getActiveReportBlocks(
  userId: string
): Promise<ReportBlock[]> {
  try {
    const { data: blocks, error } = await supabase
      .from("report_blocks")
      .select(`
        *,
        report_block_type:report_block_types(
          block_size,
          with_history,
          price
        )
      `)
      .eq("user_id", userId)
      .eq("is_active", true)
      .lt("reports_used", supabase.raw("reports_total"))
      .gt("expiry_date", new Date().toISOString())
      .order("expiry_date", { ascending: true }); // FIFO ordering

    if (error) {
      console.error("Error getting report blocks:", error);
      return [];
    }

    return blocks as ReportBlock[];
  } catch (error) {
    console.error("Error fetching report blocks:", error);
    return [];
  }
}

/**
 * Get subscription usage summary for current billing period
 */
export async function getCurrentUsageSummary(
  subscriptionId: string
): Promise<SubscriptionUsageSummary | null> {
  try {
    const today = new Date().toISOString().split("T")[0];

    const { data: summary, error } = await supabase
      .from("subscription_usage_summary")
      .select("*")
      .eq("subscription_id", subscriptionId)
      .lte("billing_period_start", today)
      .gte("billing_period_end", today)
      .single();

    if (error) {
      console.error("Error getting usage summary:", error);
      return null;
    }

    return summary as SubscriptionUsageSummary;
  } catch (error) {
    console.error("Error fetching usage summary:", error);
    return null;
  }
}

/**
 * Check if user can create a report (has available reports)
 * Simple boolean check without full details
 */
export async function canCreateReport(userId: string): Promise<boolean> {
  const available = await getUserAvailableReports(userId);
  return available.total_available > 0;
}

/**
 * Get subscription with plan details
 */
export async function getSubscriptionWithPlan(
  userId: string
): Promise<{ subscription: Subscription; plan: Plan } | null> {
  try {
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select(`
        *,
        plan:plans(*)
      `)
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    if (subError || !subscription) {
      return null;
    }

    return {
      subscription: subscription as Subscription,
      plan: subscription.plan as Plan,
    };
  } catch (error) {
    console.error("Error getting subscription with plan:", error);
    return null;
  }
}

/**
 * Create a placeholder report for usage tracking
 * Used when incrementUsage is called before report is fully created
 */
export async function createPlaceholderReport(
  inspectionId: string
): Promise<string | null> {
  try {
    const { data: report, error } = await supabase
      .from("reports")
      .insert({
        inspection_id: inspectionId,
        summary: "Report generation in progress...",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error creating placeholder report:", error);
      return null;
    }

    return report.id;
  } catch (error) {
    console.error("Error creating placeholder report:", error);
    return null;
  }
}

/**
 * Legacy function for backward compatibility
 * Wraps new recordReportUsage function
 * 
 * @deprecated Use recordReportUsage instead for better control
 */
export async function incrementUsage(
  userId: string,
  inspectionId: string,
  increment: number = 1
): Promise<{
  success: boolean;
  error?: string;
  usage?: {
    used: number;
    limit: number;
    remaining: number;
  };
}> {
  try {
    // Only support increment of 1 with new system
    if (increment !== 1) {
      return {
        success: false,
        error: "Only single report increment supported",
      };
    }

    // Create placeholder report if needed
    const reportId = await createPlaceholderReport(inspectionId);
    if (!reportId) {
      return {
        success: false,
        error: "Failed to create placeholder report",
      };
    }

    // Record usage using new system
    const result = await recordReportUsage(userId, inspectionId, reportId, false);

    if (!result.success) {
      return {
        success: false,
        error: result.message,
      };
    }

    // Get updated available reports for usage info
    const available = await getUserAvailableReports(userId);

    return {
      success: true,
      usage: {
        used: 1, // Just recorded one usage
        limit: available.subscription_available + available.blocks_available,
        remaining: available.total_available,
      },
    };
  } catch (error) {
    console.error("Error incrementing usage:", error);
    return {
      success: false,
      error: "Failed to increment usage",
    };
  }
}

/**
 * Get user's report usage history
 */
export async function getReportUsageHistory(
  userId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const { data: usageHistory, error } = await supabase
      .from("report_usage")
      .select(`
        *,
        inspection:inspections(id, vin, status),
        report:reports(id, summary)
      `)
      .eq("user_id", userId)
      .order("usage_date", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error getting usage history:", error);
      return [];
    }

    return usageHistory;
  } catch (error) {
    console.error("Error fetching usage history:", error);
    return [];
  }
}

/**
 * Check if subscription will renew or cancel
 */
export async function willSubscriptionRenew(
  subscriptionId: string
): Promise<boolean> {
  try {
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("cancel_at_period_end, status")
      .eq("id", subscriptionId)
      .single();

    if (error || !subscription) {
      return false;
    }

    return (
      subscription.status === "active" &&
      !subscription.cancel_at_period_end
    );
  } catch (error) {
    console.error("Error checking subscription renewal:", error);
    return false;
  }
}
