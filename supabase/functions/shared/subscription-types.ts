
export interface SubscriptionPlan {
  id: string
  name: string
  description: string
  price: number
  interval: "month" | "year"
  features: string[]
  maxReports: number
  priority: "standard" | "priority" | "premium"
  popular?: boolean
  stripePriceId: string
  annualPriceId?: string
  annualPrice?: number
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Essential auction insights for single-lot dealers",
    price: 25,
    interval: "month",
    features: [
      "100 VIN report credits / month (30-day rollover)",
      "1 user seat",
      "Chrome extension + PDF export",
      "Community email support",
      "Overage: $2.25 per extra report",
    ],
    maxReports: 4,
    priority: "standard",
    stripePriceId: Deno.env.get("NEXT_PUBLIC_STRIPE_STARTER_MONTHLY_PRICE_ID") || "",
    annualPriceId: Deno.env.get("NEXT_PUBLIC_STRIPE_STARTER_ANNUAL_PRICE_ID") || "",
    annualPrice: 1990,
  },
  {
    id: "pro",
    name: "Pro",
    description: "Built for franchise rooftops & high-turn independents",
    price: 119,
    interval: "month",
    features: [
      "350 VIN report credits / month (30-day rollover)",
      "3 user seats (add'l seats $25/user)",
      "Saved searches & batch VIN upload",
      "Priority 1-hour chat support",
      "Overage: $1.75 per extra report",
    ],
    maxReports: 25,
    priority: "priority",
    popular: true,
    stripePriceId: Deno.env.get("NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID") || "",
    annualPriceId: Deno.env.get("NEXT_PUBLIC_STRIPE_PRO_ANNUAL_PRICE_ID") || "",
    annualPrice: 4990,
  },
  {
    id: "elite",
    name: "Elite",
    description: "Unlimited power for group stores & wholesalers",
    price: 349,
    interval: "month",
    features: [
      "1,000 VIN report credits / month (30-day rollover)",
      "Unlimited user seats",
      "REST/API & SFTP data feeds",
      "Dedicated Customer Success Manager",
      "99.9% uptime SLA & phone support",
      "Overage: $1.25 per extra report",
    ],
    maxReports: 80,
    priority: "premium",
    stripePriceId: Deno.env.get("NEXT_PUBLIC_STRIPE_ELITE_MONTHLY_PRICE_ID") || "",
    annualPriceId: Deno.env.get("NEXT_PUBLIC_STRIPE_ELITE_ANNUAL_PRICE_ID") || "",
    annualPrice: 9990,
  },
]


export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'active' | 'canceled' | 'past_due' | 'incomplete' | 'trialing';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  stripe_subscription_id?: string;
  stripe_customer_id?: string;
  reports_used: number;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionAccessCheck {
  hasAccess: boolean;
  canCreateReport: boolean;
  remainingReports: number;
  subscription?: Subscription;
  plan?: SubscriptionPlan;
}
