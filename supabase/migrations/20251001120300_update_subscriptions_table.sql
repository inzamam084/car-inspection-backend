-- Migration: Update subscriptions table schema
-- Description: Update subscriptions table to match new business requirements

-- Drop old constraint if exists
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_id_check;
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;

-- Add new columns if they don't exist
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS is_annual BOOLEAN DEFAULT false;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS parent_subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL;

-- Modify existing columns
-- Change plan_id from VARCHAR to UUID and make it a foreign key to plans table
-- First, we need to handle existing data

-- Step 1: Add a temporary column for the new UUID plan_id
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS plan_id_new UUID;

-- Step 2: Create a mapping from old plan names to new plan UUIDs (if needed)
-- This will be populated based on the plans table
DO $$
DECLARE
    starter_plan_uuid UUID;
    pro_plan_uuid UUID;
    dealer_plan_uuid UUID;
    dealer_plus_plan_uuid UUID;
BEGIN
    -- Get UUIDs from plans table
    SELECT id INTO starter_plan_uuid FROM public.plans WHERE name = 'Starter';
    SELECT id INTO pro_plan_uuid FROM public.plans WHERE name = 'Pro';
    SELECT id INTO dealer_plan_uuid FROM public.plans WHERE name = 'Dealer';
    SELECT id INTO dealer_plus_plan_uuid FROM public.plans WHERE name = 'Dealer+';

    -- Map old plan_id values to new UUIDs
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'plan_id') THEN
        UPDATE public.subscriptions SET plan_id_new =
            CASE
                WHEN plan_id IN ('starter', 'basic') THEN starter_plan_uuid
                WHEN plan_id IN ('pro') THEN pro_plan_uuid
                WHEN plan_id IN ('elite') THEN dealer_plan_uuid
                WHEN plan_id IN ('starter_plan') THEN pro_plan_uuid
                WHEN plan_id IN ('pro_plan') THEN pro_plan_uuid
                WHEN plan_id IN ('elite_plan') THEN dealer_plus_plan_uuid
                ELSE NULL
            END
        WHERE plan_id_new IS NULL;
    END IF;
END $$;

-- Step 3: Drop old plan_id and rename new one
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS plan_id CASCADE;
ALTER TABLE public.subscriptions RENAME COLUMN plan_id_new TO plan_id;

-- Step 4: Add foreign key constraint
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE RESTRICT;

-- Update status enum constraint
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'past_due', 'canceled', 'trialing'));

-- Make plan_id required
ALTER TABLE public.subscriptions ALTER COLUMN plan_id SET NOT NULL;

-- Remove cancel_at_period_end if it exists (business logic: cancel only after billing month completes)
-- This will be handled in application logic through Stripe
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS cancel_at_period_end;

-- Drop reports_used column as it will be tracked differently
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS reports_used;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON public.subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON public.subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_parent_subscription_id ON public.subscriptions(parent_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_current_period_end ON public.subscriptions(current_period_end);

-- Update comments
COMMENT ON TABLE public.subscriptions IS 'User subscriptions - cancellations take effect after current billing period ends';
COMMENT ON COLUMN public.subscriptions.user_id IS 'Subscription owner (references profiles.id)';
COMMENT ON COLUMN public.subscriptions.plan_id IS 'Selected plan (references plans.id)';
COMMENT ON COLUMN public.subscriptions.stripe_subscription_id IS 'Stripe subscription reference ID';
COMMENT ON COLUMN public.subscriptions.status IS 'Subscription status: active, past_due, canceled, trialing';
COMMENT ON COLUMN public.subscriptions.start_date IS 'Subscription effective start date';
COMMENT ON COLUMN public.subscriptions.current_period_end IS 'Current billing period end date from Stripe';
COMMENT ON COLUMN public.subscriptions.is_annual IS 'True if annual/prepaid subscription, false if monthly';
COMMENT ON COLUMN public.subscriptions.parent_subscription_id IS 'Reference to previous subscription if this is an upgrade/downgrade';

-- Grant permissions
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;
