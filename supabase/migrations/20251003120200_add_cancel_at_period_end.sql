-- Migration: Add cancel_at_period_end to subscriptions table
-- Description: Track subscription cancellations scheduled for end of billing period

-- ============================================================================
-- 1. Add cancel_at_period_end column
-- ============================================================================
ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

-- Create index for queries filtering by cancellation status
CREATE INDEX IF NOT EXISTS idx_subscriptions_cancel_at_period_end 
ON public.subscriptions(cancel_at_period_end) 
WHERE cancel_at_period_end = TRUE;

-- ============================================================================
-- 9. Add helpful comments
-- ============================================================================
COMMENT ON COLUMN public.subscriptions.cancel_at_period_end IS 'If true, subscription will be canceled when current_period_end is reached';
