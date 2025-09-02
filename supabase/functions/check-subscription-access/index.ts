import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UserSubscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  reports_used: number;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  maxReports: number;
  price: number;
  durationDays: number;
}

// Define subscription plans (matching the correct subscription structure)
const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "starter",
    name: "Starter",
    maxReports: 100,
    price: 199,
    durationDays: 30,
  },
  {
    id: "pro",
    name: "Pro",
    maxReports: 350,
    price: 499,
    durationDays: 30,
  },
  {
    id: "elite",
    name: "Elite",
    maxReports: 1000,
    price: 999,
    durationDays: 30,
  },
];

async function checkSubscriptionAccess(userId: string) {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log("Checking subscription access for user:", userId);

    // Get active subscription
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    console.log("Fetched subscription:", subscription);

    if (error || !subscription) {
      return {
        hasAccess: false,
        subscription: null,
        canCreateReport: false,
        remainingReports: 0,
      };
    }

    // Get plan details
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === subscription.plan_id);
    if (!plan) {
      return {
        hasAccess: false,
        subscription: null,
        canCreateReport: false,
        remainingReports: 0,
      };
    }

    // Check if subscription is within period
    const now = new Date();
    const periodEnd = new Date(subscription.current_period_end || subscription.endDate);

    if (now > periodEnd && !subscription.cancel_at_period_end) {
      return {
        hasAccess: false,
        subscription,
        canCreateReport: false,
        remainingReports: 0,
      };
    }

    // Calculate remaining reports
    const remainingReports =
      plan.maxReports === -1
        ? -1 // Unlimited
        : Math.max(0, plan.maxReports - (subscription.reports_used || 0));

    const canCreateReport = plan.maxReports === -1 || remainingReports > 0;

    return {
      hasAccess: true,
      subscription,
      canCreateReport,
      remainingReports,
    };
  } catch (error) {
    console.error("Error checking subscription access:", error);
    return {
      hasAccess: false,
      subscription: null,
      canCreateReport: false,
      remainingReports: 0,
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // Get the user from the JWT token
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (userError || !user) {
      throw new Error('Invalid user token')
    }

    // Check subscription access
    const result = await checkSubscriptionAccess(user.id);

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error) {
    console.error('Error in check-subscription-access function:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        hasAccess: false,
        subscription: null,
        canCreateReport: false,
        remainingReports: 0,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
