import {
  SUBSCRIPTION_PLANS,
  type Subscription,
  type SubscriptionAccessCheck,
  type SubscriptionPlan,
} from "./subscription-types.ts";
import { createDatabaseService } from "./database-service.ts";

// Initialize database service with service role key for subscription operations
const dbService = createDatabaseService();
const supabase = dbService.getClient();

export async function checkSubscriptionAccess(
  userId: string
): Promise<SubscriptionAccessCheck> {
  try {
    // Get current subscription
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    if (subError || !subscription) {
      return {
        hasAccess: false,
        canCreateReport: false,
        remainingReports: 0,
      };
    }

    // Get plan details
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === subscription.plan_id);
    if (!plan) {
      return {
        hasAccess: false,
        canCreateReport: false,
        remainingReports: 0,
        subscription,
      };
    }

    // Check if subscription is still valid (not expired)
    const now = new Date();
    const periodEnd = new Date(subscription.current_period_end);

    if (now > periodEnd) {
      return {
        hasAccess: false,
        canCreateReport: false,
        remainingReports: 0,
        subscription,
        plan,
      };
    }

    // Calculate remaining reports
    const remainingReports =
      plan.maxReports === -1
        ? -1 // unlimited
        : Math.max(0, plan.maxReports - subscription.reports_used);

    const canCreateReport = plan.maxReports === -1 || remainingReports > 0;

    return {
      hasAccess: true,
      canCreateReport,
      remainingReports,
      subscription,
      plan,
    };
  } catch (error) {
    console.error("Error checking subscription access:", error);
    return {
      hasAccess: false,
      canCreateReport: false,
      remainingReports: 0,
    };
  }
}

export async function incrementUsage(
  userId: string,
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
    // Get current subscription
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    if (subError || !subscription) {
      return {
        success: false,
        error: "No active subscription found",
      };
    }

    // Get plan limits
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === subscription.plan_id);
    if (!plan) {
      return {
        success: false,
        error: "Invalid plan",
      };
    }

    // Check if user has reached limit (unlimited plans have maxReports = -1)
    if (
      plan.maxReports !== -1 &&
      subscription.reports_used + increment > plan.maxReports
    ) {
      return {
        success: false,
        error: "Usage limit exceeded",
        usage: {
          used: subscription.reports_used,
          limit: plan.maxReports,
          remaining: Math.max(0, plan.maxReports - subscription.reports_used),
        },
      };
    }

    // Increment usage
    const { data: updatedSub, error: updateError } = await supabase
      .from("subscriptions")
      .update({ reports_used: subscription.reports_used + increment })
      .eq("id", subscription.id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating usage:", updateError);
      return {
        success: false,
        error: "Failed to update usage",
      };
    }

    return {
      success: true,
      usage: {
        used: updatedSub.reports_used,
        limit: plan.maxReports,
        remaining:
          plan.maxReports === -1
            ? -1
            : Math.max(0, plan.maxReports - updatedSub.reports_used),
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
