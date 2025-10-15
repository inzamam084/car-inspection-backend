import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { differenceInCalendarDays } from "https://esm.sh/date-fns@3.6.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey)
      throw new Error("Supabase environment variables missing");

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // --- Authenticate user ---
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Invalid user token");
    const userId = user.id;

    // --- Subscription ---
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due"])
      .limit(1);
    const sub = subs?.[0] || null;

    // --- Plan ---
    const plan =
      sub &&
      (
        await supabase
          .from("plans")
          .select("*, plan_features(feature,position)")
          .eq("id", sub.plan_id)
          .maybeSingle()
      ).data;

    const features =
      plan?.plan_features
        ?.sort((a: any, b: any) => a.position - b.position)
        .map((f: any) => f.feature) || [];

    // --- Scheduled plan (optional) ---
    const hasScheduled =
      !!sub?.scheduled_plan_id && !!sub?.scheduled_change_date;

    // --- Usage summary ---
    const { data: usageRows } = await supabase
      .from("subscription_usage_summary")
      .select("*")
      .eq("subscription_id", sub?.id || "")
      .order("billing_period_start", { ascending: false })
      .limit(1);
    const usage = usageRows?.[0] || null;

    // --- Report blocks ---
    const { data: blocksRaw } = await supabase
      .from("report_blocks")
      .select("*, report_block_types(with_history)")
      .eq("user_id", userId)
      .eq("is_active", true);

    const now = new Date();
    const blocks =
      (blocksRaw || []).filter(
        (b) => new Date(b.expiry_date) > now && b.reports_used < b.reports_total
      ) || [];

    // --- Addons ---
    const { data: addons } = await supabase
      .from("subscription_addons")
      .select("addon_type, quantity, price_per_unit")
      .eq("subscription_id", sub?.id || "")
      .eq("is_active", true);

    // --- Seats ---
    const { data: seats } = await supabase
      .from("seats")
      .select("id, status, user_email")
      .eq("subscription_id", sub?.id || "")
      .in("status", ["invited", "active"]);

    // --- Payments ---
    const { data: payments } = await supabase
      .from("payments")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    // === Derived Computations ===
    const isActive =
      sub?.status === "active" && new Date(sub.current_period_end) > now;
    const daysUntilCancel =
      sub?.cancel_at_period_end && sub.current_period_end
        ? Math.max(
            0,
            differenceInCalendarDays(new Date(sub.current_period_end), now)
          )
        : null;

    const included = usage?.reports_included || plan?.included_reports || 0;
    const used = usage?.reports_used || 0;
    const remainingPlan =
      usage?.reports_remaining ?? Math.max(0, included - used);
    const remainingBlocks = blocks.reduce(
      (sum, b) => sum + (b.reports_total - b.reports_used),
      0
    );
    const totalRemaining = remainingPlan + remainingBlocks;
    const usagePct = included ? Math.round((used / included) * 100) : 0;

    const totalBlockReports = blocks.reduce((s, b) => s + b.reports_total, 0);
    const usedBlockReports = blocks.reduce((s, b) => s + b.reports_used, 0);
    const expiringSoon = blocks.filter(
      (b) => differenceInCalendarDays(new Date(b.expiry_date), now) <= 7
    ).length;

    const totalPaid = (payments || [])
      .filter((p) => p.status === "succeeded")
      .reduce((s, p) => s + Number(p.amount), 0);

    // === Response ===
    const result = {
      userId,
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            isAnnual: sub.is_annual,
            currentPeriod: {
              start: sub.current_period_start,
              end: sub.current_period_end,
            },
            scheduledChange: hasScheduled
              ? {
                  planId: sub.scheduled_plan_id,
                  isAnnual: sub.scheduled_is_annual,
                  changeDate: sub.scheduled_change_date,
                  stripeScheduleId: sub.stripe_schedule_id,
                }
              : null,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            daysUntilCancellation: daysUntilCancel,
            stripeSubscriptionId: sub.stripe_subscription_id,
          }
        : null,

      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            monthlyFee: plan.monthly_fee,
            annualFee: plan.annual_fee,
            includedReports: plan.included_reports,
            extraReportPrice: plan.extra_report_price,
            historyAddonPrice: plan.history_addon_price,
            includedSeats: plan.included_seats,
            features,
          }
        : null,

      usage: {
        included,
        used,
        remainingFromPlan: remainingPlan,
        totalRemaining,
        usagePercentage: usagePct,
        canCreateReport: totalRemaining > 0,
        billingPeriodStart: usage?.billing_period_start || null,
        billingPeriodEnd: usage?.billing_period_end || null,
        lastResetDate: usage?.last_reset_date || null,
      },

      blocks: {
        total: blocks.length,
        used: usedBlockReports,
        remaining: totalBlockReports - usedBlockReports,
        expiringSoon,
        list: blocks.map((b) => ({
          id: b.id,
          remaining: b.reports_total - b.reports_used,
          expiry: b.expiry_date,
          withHistory: !!b.report_block_types?.with_history,
        })),
      },

      billing: {
        addons: addons || [],
        seats: seats || [],
        payments: payments || [],
        totalPaid,
      },

      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    console.error("subscription-usage error:", err);
    return new Response(
      JSON.stringify({
        error: err.message,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
