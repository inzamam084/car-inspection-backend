import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkSubscriptionAccess,
  getSubscriptionStatus,
  getUserAvailableReports,
  getActiveReportBlocks,
  getActivePlans,
  getPlanById,
  getCurrentUsageSummary,
} from "../shared/subscription-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Edge Function: Get Subscription Usage
 * 
 * Returns comprehensive subscription details including:
 * - Active subscription status and plan details
 * - Usage statistics (used/remaining reports)
 * - Available report blocks
 * - Billing period information
 * - Available plans for upgrades
 * 
 * Authentication: Required (JWT token)
 * 
 * Response Format:
 * {
 *   user_id: string;
 *   subscription: {
 *     status: "active" | "past_due" | "canceled" | "trialing" | "inactive";
 *     plan: Plan | null;
 *     current_period_start: string | null;
 *     current_period_end: string | null;
 *     cancel_at_period_end: boolean;
 *     days_until_renewal: number;
 *     is_annual: boolean;
 *   };
 *   usage: {
 *     subscription_reports: {
 *       included: number;
 *       used: number;
 *       available: number;
 *       billing_period_start: string | null;
 *       billing_period_end: string | null;
 *     };
 *     block_reports: {
 *       total_available: number;
 *       blocks: Array<{
 *         id: string;
 *         reports_remaining: number;
 *         expiry_date: string;
 *         with_history: boolean;
 *       }>;
 *     };
 *     total_available: number;
 *     can_create_report: boolean;
 *   };
 *   available_plans: Plan[];
 *   timestamp: string;
 * }
 */

interface SubscriptionUsageResponse {
  user_id: string;
  subscription: {
    status: "active" | "past_due" | "canceled" | "trialing" | "inactive";
    plan: any | null;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    days_until_renewal: number;
    is_annual: boolean;
  };
  usage: {
    subscription_reports: {
      included: number;
      used: number;
      available: number;
      billing_period_start: string | null;
      billing_period_end: string | null;
    };
    block_reports: {
      total_available: number;
      blocks: Array<{
        id: string;
        reports_remaining: number;
        expiry_date: string;
        with_history: boolean;
      }>;
    };
    total_available: number;
    can_create_report: boolean;
  };
  available_plans: any[];
  timestamp: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    // Create Supabase client with user's token for auth
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Get the user from the JWT token
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      throw new Error("Invalid user token");
    }

    console.log("Fetching subscription usage for user:", user.id);

    // Get subscription status
    const subscriptionStatus = await getSubscriptionStatus(user.id);
    console.log("Subscription status:", subscriptionStatus);

    // Get available reports (subscription + blocks)
    const availableReports = await getUserAvailableReports(user.id);
    console.log("Available reports:", availableReports);

    // Get active report blocks
    const activeBlocks = await getActiveReportBlocks(user.id);
    console.log("Active blocks:", activeBlocks);

    // Get plan details if subscription exists
    let planDetails = null;
    let usageSummary = null;
    let isAnnual = false;

    if (subscriptionStatus.subscription) {
      planDetails = await getPlanById(subscriptionStatus.subscription.plan_id);
      isAnnual = subscriptionStatus.subscription.is_annual;

      // Get current billing period usage
      if (subscriptionStatus.subscription.id) {
        usageSummary = await getCurrentUsageSummary(
          subscriptionStatus.subscription.id
        );
      }
    }

    // Get all available plans for upgrade/downgrade options
    const allPlans = await getActivePlans();

    // Build response
    const response: SubscriptionUsageResponse = {
      user_id: user.id,
      subscription: {
        status: subscriptionStatus.subscription?.status || "inactive",
        plan: planDetails,
        current_period_start:
          subscriptionStatus.subscription?.current_period_start || null,
        current_period_end:
          subscriptionStatus.subscription?.current_period_end || null,
        cancel_at_period_end:
          subscriptionStatus.subscription?.cancel_at_period_end || false,
        days_until_renewal: subscriptionStatus.daysUntilRenewal,
        is_annual: isAnnual,
      },
      usage: {
        subscription_reports: {
          included: planDetails?.included_reports || 0,
          used: usageSummary?.reports_used || 0,
          available: availableReports.subscription_available,
          billing_period_start: usageSummary?.billing_period_start || null,
          billing_period_end: usageSummary?.billing_period_end || null,
        },
        block_reports: {
          total_available: availableReports.blocks_available,
          blocks: activeBlocks.map((block) => ({
            id: block.id,
            reports_remaining: block.reports_total - block.reports_used,
            expiry_date: block.expiry_date,
            with_history: block.report_block_type?.with_history || false,
          })),
        },
        total_available: availableReports.total_available,
        can_create_report: availableReports.total_available > 0,
      },
      available_plans: allPlans,
      timestamp: new Date().toISOString(),
    };

    console.log("Returning subscription usage:", response);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in get-subscription-usage function:", error);

    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
        user_id: null,
        subscription: {
          status: "inactive",
          plan: null,
          current_period_start: null,
          current_period_end: null,
          cancel_at_period_end: false,
          days_until_renewal: 0,
          is_annual: false,
        },
        usage: {
          subscription_reports: {
            included: 0,
            used: 0,
            available: 0,
            billing_period_start: null,
            billing_period_end: null,
          },
          block_reports: {
            total_available: 0,
            blocks: [],
          },
          total_available: 0,
          can_create_report: false,
        },
        available_plans: [],
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
