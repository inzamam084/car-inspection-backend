/**
 * Subscription Types - Updated for New Database Schema
 * 
 * Changes from old schema:
 * - Plans now stored in database, not hardcoded
 * - Subscription tracking uses new report_usage system
 * - Support for report blocks (pre-purchased reports)
 * - Removed stripe_customer_id from subscriptions (now in profiles)
 * - Added subscription_addons support
 * - Added plan_id as UUID instead of string
 */

export interface Plan {
  id: string; // UUID
  name: string;
  monthly_fee: number;
  annual_fee: number;
  included_reports: number;
  extra_report_price: number | null;
  history_addon_price: number | null;
  included_seats: number;
  extra_seat_price: number | null;
  stripe_price_id_monthly: string | null;
  stripe_price_id_annual: string | null;
  is_active: boolean;
  display_order: number;
  is_popular: boolean;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string; // UUID
  user_id: string; // UUID
  plan_id: string; // UUID reference to plans table
  status: "active" | "past_due" | "canceled" | "trialing";
  current_period_start: string; // TIMESTAMP WITH TIME ZONE
  current_period_end: string; // TIMESTAMP WITH TIME ZONE
  stripe_subscription_id: string | null;
  start_date: string | null; // DATE
  is_annual: boolean;
  parent_subscription_id: string | null; // UUID for upgrade/downgrade tracking
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionAddon {
  id: string; // UUID
  subscription_id: string; // UUID
  addon_type: "history" | "seat" | "extra_report";
  quantity: number;
  price_per_unit: number;
  stripe_item_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReportBlock {
  id: string; // UUID
  user_id: string; // UUID
  report_block_type_id: string; // UUID
  reports_total: number;
  reports_used: number;
  purchase_date: string; // TIMESTAMP WITH TIME ZONE
  expiry_date: string; // TIMESTAMP WITH TIME ZONE (90 days from purchase)
  stripe_payment_intent_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReportBlockType {
  id: string; // UUID
  plan_id: string; // UUID
  block_size: number; // 5, 10, 20, 50
  with_history: boolean;
  price: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionUsageSummary {
  id: string; // UUID
  subscription_id: string; // UUID
  billing_period_start: string; // DATE
  billing_period_end: string; // DATE
  reports_included: number;
  reports_used: number;
  reports_remaining: number; // Computed column
  last_reset_date: string | null; // TIMESTAMP WITH TIME ZONE
  created_at: string;
  updated_at: string;
}

export interface ReportUsage {
  id: string; // UUID
  user_id: string; // UUID
  inspection_id: string; // UUID
  report_id: string; // UUID
  usage_type: "subscription_included" | "block" | "pay_per_report" | "free_trial";
  subscription_id: string | null; // UUID
  report_block_id: string | null; // UUID
  had_history: boolean;
  usage_date: string; // TIMESTAMP WITH TIME ZONE
  billing_period_start: string | null; // DATE
  billing_period_end: string | null; // DATE
  created_at: string;
}

/**
 * Enhanced access check result with new schema support
 */
export interface SubscriptionAccessCheck {
  hasAccess: boolean;
  canCreateReport: boolean;
  
  // Subscription reports
  subscriptionReports: number; // Available from current subscription
  subscriptionIncluded: number; // Total included in subscription
  subscriptionUsed: number; // Used from subscription this period
  
  // Block reports
  blockReports: number; // Available from purchased blocks
  activeBlocks: Array<{
    id: string;
    reports_remaining: number;
    expiry_date: string;
    with_history: boolean;
  }>;
  
  // Total available
  totalAvailableReports: number; // subscription + blocks
  
  // Related data
  subscription?: Subscription;
  plan?: Plan;
  usageSummary?: SubscriptionUsageSummary;
  
  // Billing period info
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
}

/**
 * Result from checking user's available reports
 * (matches the RPC function return type)
 */
export interface AvailableReportsResult {
  total_available: number;
  subscription_available: number;
  blocks_available: number;
  active_subscription_id: string | null;
  active_blocks: Array<{
    id: string;
    reports_remaining: number;
    expiry_date: string;
    with_history: boolean;
  }>;
}

/**
 * Result from recording report usage
 * (matches the RPC function return type)
 */
export interface RecordUsageResult {
  success: boolean;
  usage_type: "subscription_included" | "block" | "pay_per_report" | "free_trial" | "duplicate" | "insufficient";
  message: string;
  remaining_reports: number;
}

/**
 * Plan features for display
 */
export interface PlanFeature {
  id: string; // UUID
  plan_id: string; // UUID
  feature: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * Extended plan information with features
 */
export interface PlanWithFeatures extends Plan {
  features: PlanFeature[];
}

/**
 * Usage tracking options for middleware
 */
export interface UsageTrackingOptions {
  inspectionId: string;
  reportId?: string; // If report already created
  hadHistory?: boolean; // Whether history lookup was used
  autoCreateReport?: boolean; // Create placeholder report if not provided
}

/**
 * Subscription status check for middleware
 */
export interface SubscriptionStatus {
  isActive: boolean;
  isPastDue: boolean;
  isCanceled: boolean;
  willCancelAtPeriodEnd: boolean;
  daysUntilRenewal: number;
  subscription?: Subscription;
}
