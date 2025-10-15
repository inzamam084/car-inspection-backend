-- Migration: Add stripe_schedule_id to subscriptions table
-- Description: Store Stripe Schedule ID for managing scheduled subscription changes in Stripe

-- ============================================================================
-- 1. Add stripe_schedule_id column
-- ============================================================================
ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS stripe_schedule_id TEXT;

-- ============================================================================
-- 9. Add helpful comments
-- ============================================================================
COMMENT ON COLUMN public.subscriptions.stripe_schedule_id IS 'Stripe Schedule ID for managing scheduled subscription changes (e.g., sub_sched_xxxxx)';