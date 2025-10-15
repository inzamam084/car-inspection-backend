-- Migration: Add scheduled plan change fields to subscriptions table
-- Description: Allow users to schedule plan upgrades/downgrades that take effect at end of current billing period

-- ============================================================================
-- 1. Add scheduled plan change columns
-- ============================================================================
ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS scheduled_plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS scheduled_is_annual BOOLEAN,
ADD COLUMN IF NOT EXISTS scheduled_change_date TIMESTAMPTZ;

-- ============================================================================
-- 10. Add helpful comments
-- ============================================================================
COMMENT ON COLUMN public.subscriptions.scheduled_plan_id IS 'Plan to switch to at scheduled_change_date (references plans.id)';
COMMENT ON COLUMN public.subscriptions.scheduled_is_annual IS 'Whether the scheduled plan will use annual billing (NULL = keep current billing cycle)';
COMMENT ON COLUMN public.subscriptions.scheduled_change_date IS 'When the plan change will take effect (typically end of current billing period)';
