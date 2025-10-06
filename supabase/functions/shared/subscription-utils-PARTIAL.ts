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

// ... [rest of the file remains the same - recordReportUsage and all other functions]
