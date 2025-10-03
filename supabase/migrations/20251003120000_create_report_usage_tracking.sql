-- Migration: Create report usage tracking system
-- Description: Track reports used against subscriptions and report blocks with proper deduction logic

-- ============================================================================
-- 1. Create report_usage table to track every report consumption
-- ============================================================================
CREATE TABLE public.report_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    inspection_id UUID NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
    report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    
    -- Track what was consumed
    usage_type TEXT NOT NULL,
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    report_block_id UUID REFERENCES public.report_blocks(id) ON DELETE SET NULL,
    
    -- Additional metadata
    had_history BOOLEAN NOT NULL DEFAULT false,
    usage_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    billing_period_start DATE,
    billing_period_end DATE,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Ensure usage_type is valid
    CONSTRAINT report_usage_type_check CHECK (
        usage_type IN ('subscription_included', 'block', 'pay_per_report', 'free_trial')
    ),
    
    -- Ensure one report is only tracked once
    -- CONSTRAINT report_usage_unique_report UNIQUE (report_id),
    
    -- If usage_type is 'subscription_included', subscription_id must be set
    -- CONSTRAINT report_usage_subscription_logic CHECK (
    --     (usage_type = 'subscription_included' AND subscription_id IS NOT NULL) OR
    --     (usage_type != 'subscription_included')
    -- ),
    
    -- If usage_type is 'block', report_block_id must be set
    -- CONSTRAINT report_usage_block_logic CHECK (
    --     (usage_type = 'block' AND report_block_id IS NOT NULL) OR
    --     (usage_type != 'block')
    -- )
);

-- Create indexes for better performance
CREATE INDEX idx_report_usage_user_id ON public.report_usage(user_id);
CREATE INDEX idx_report_usage_inspection_id ON public.report_usage(inspection_id);
CREATE INDEX idx_report_usage_report_id ON public.report_usage(report_id);
CREATE INDEX idx_report_usage_subscription_id ON public.report_usage(subscription_id);
CREATE INDEX idx_report_usage_report_block_id ON public.report_usage(report_block_id);
CREATE INDEX idx_report_usage_usage_type ON public.report_usage(usage_type);
CREATE INDEX idx_report_usage_usage_date ON public.report_usage(usage_date DESC);
CREATE INDEX idx_report_usage_billing_period ON public.report_usage(billing_period_start, billing_period_end);

-- Create composite index for subscription period queries
CREATE INDEX idx_report_usage_subscription_period ON public.report_usage(
    subscription_id, 
    billing_period_start, 
    billing_period_end
) WHERE subscription_id IS NOT NULL;

-- ============================================================================
-- 2. Create subscription_usage_summary table for quick lookups
-- ============================================================================
CREATE TABLE public.subscription_usage_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    
    -- Usage tracking
    reports_included INTEGER NOT NULL DEFAULT 0,
    reports_used INTEGER NOT NULL DEFAULT 0,
    reports_remaining INTEGER GENERATED ALWAYS AS (reports_included - reports_used) STORED,
    
    -- Metadata
    last_reset_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Ensure valid usage
    CONSTRAINT subscription_usage_summary_usage_check CHECK (reports_used >= 0),
    CONSTRAINT subscription_usage_summary_included_check CHECK (reports_included >= 0),
    
    -- One summary per subscription per billing period
    CONSTRAINT subscription_usage_summary_unique_period UNIQUE (subscription_id, billing_period_start, billing_period_end)
);

-- Create indexes
CREATE INDEX idx_subscription_usage_summary_subscription_id ON public.subscription_usage_summary(subscription_id);
CREATE INDEX idx_subscription_usage_summary_period ON public.subscription_usage_summary(billing_period_start, billing_period_end);
CREATE INDEX idx_subscription_usage_summary_updated_at ON public.subscription_usage_summary(updated_at DESC);

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_subscription_usage_summary_updated_at
    BEFORE UPDATE ON public.subscription_usage_summary
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- -- ============================================================================
-- -- 3. Create function to get available reports for a user
-- -- ============================================================================
-- CREATE OR REPLACE FUNCTION public.get_user_available_reports(p_user_id UUID)
-- RETURNS TABLE (
--     total_available INTEGER,
--     subscription_available INTEGER,
--     blocks_available INTEGER,
--     active_subscription_id UUID,
--     active_blocks JSONB
-- ) 
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     v_subscription_available INTEGER := 0;
--     v_blocks_available INTEGER := 0;
--     v_active_subscription_id UUID;
--     v_active_blocks JSONB := '[]'::jsonb;
--     v_subscription_reports_used INTEGER := 0;
--     v_subscription_reports_included INTEGER := 0;
-- BEGIN
--     -- Get active subscription info
--     SELECT 
--         s.id,
--         COALESCE(p.included_reports, 0),
--         COALESCE(sus.reports_used, 0)
--     INTO 
--         v_active_subscription_id,
--         v_subscription_reports_included,
--         v_subscription_reports_used
--     FROM public.subscriptions s
--     INNER JOIN public.plans p ON s.plan_id = p.id
--     LEFT JOIN public.subscription_usage_summary sus ON (
--         sus.subscription_id = s.id 
--         AND sus.billing_period_start <= CURRENT_DATE 
--         AND sus.billing_period_end >= CURRENT_DATE
--     )
--     WHERE s.user_id = p_user_id
--         AND s.status = 'active'
--         AND s.current_period_end >= NOW()
--     ORDER BY s.created_at DESC
--     LIMIT 1;
    
--     -- Calculate subscription available reports
--     IF v_active_subscription_id IS NOT NULL THEN
--         v_subscription_available := GREATEST(0, v_subscription_reports_included - v_subscription_reports_used);
--     END IF;
    
--     -- Get active report blocks and total available
--     SELECT 
--         COALESCE(SUM(rb.reports_total - rb.reports_used), 0),
--         COALESCE(jsonb_agg(
--             jsonb_build_object(
--                 'id', rb.id,
--                 'reports_remaining', rb.reports_total - rb.reports_used,
--                 'expiry_date', rb.expiry_date,
--                 'with_history', rbt.with_history
--             ) ORDER BY rb.expiry_date ASC
--         ) FILTER (WHERE rb.reports_total - rb.reports_used > 0), '[]'::jsonb)
--     INTO 
--         v_blocks_available,
--         v_active_blocks
--     FROM public.report_blocks rb
--     INNER JOIN public.report_block_types rbt ON rb.report_block_type_id = rbt.id
--     WHERE rb.user_id = p_user_id
--         AND rb.is_active = true
--         AND rb.reports_used < rb.reports_total
--         AND rb.expiry_date > NOW();
    
--     -- Return results
--     RETURN QUERY SELECT 
--         (v_subscription_available + v_blocks_available)::INTEGER as total_available,
--         v_subscription_available::INTEGER,
--         v_blocks_available::INTEGER,
--         v_active_subscription_id,
--         v_active_blocks;
-- END;
-- $$;

-- -- ============================================================================
-- -- 4. Create function to record report usage
-- -- ============================================================================
-- CREATE OR REPLACE FUNCTION public.record_report_usage(
--     p_user_id UUID,
--     p_inspection_id UUID,
--     p_report_id UUID,
--     p_had_history BOOLEAN DEFAULT false
-- )
-- RETURNS TABLE (
--     success BOOLEAN,
--     usage_type TEXT,
--     message TEXT,
--     remaining_reports INTEGER
-- )
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     v_active_subscription_id UUID;
--     v_subscription_available INTEGER := 0;
--     v_billing_period_start DATE;
--     v_billing_period_end DATE;
--     v_reports_included INTEGER;
--     v_report_block_id UUID;
--     v_usage_type TEXT;
--     v_remaining INTEGER := 0;
-- BEGIN
--     -- Check if report already tracked
--     IF EXISTS (SELECT 1 FROM public.report_usage WHERE report_id = p_report_id) THEN
--         RETURN QUERY SELECT 
--             false::BOOLEAN,
--             'duplicate'::TEXT,
--             'Report already tracked'::TEXT,
--             0::INTEGER;
--         RETURN;
--     END IF;
    
--     -- Get active subscription and current period info
--     SELECT 
--         s.id,
--         s.current_period_start::DATE,
--         s.current_period_end::DATE,
--         COALESCE(p.included_reports, 0)
--     INTO 
--         v_active_subscription_id,
--         v_billing_period_start,
--         v_billing_period_end,
--         v_reports_included
--     FROM public.subscriptions s
--     INNER JOIN public.plans p ON s.plan_id = p.id
--     WHERE s.user_id = p_user_id
--         AND s.status = 'active'
--         AND s.current_period_end >= NOW()
--     ORDER BY s.created_at DESC
--     LIMIT 1;
    
--     -- If active subscription exists, check usage
--     IF v_active_subscription_id IS NOT NULL THEN
--         -- Get or create usage summary for current period
--         INSERT INTO public.subscription_usage_summary (
--             subscription_id,
--             billing_period_start,
--             billing_period_end,
--             reports_included,
--             reports_used
--         ) VALUES (
--             v_active_subscription_id,
--             v_billing_period_start,
--             v_billing_period_end,
--             v_reports_included,
--             0
--         )
--         ON CONFLICT (subscription_id, billing_period_start, billing_period_end) 
--         DO NOTHING;
        
--         -- Get current usage
--         SELECT reports_used, reports_included
--         INTO v_subscription_available, v_reports_included
--         FROM public.subscription_usage_summary
--         WHERE subscription_id = v_active_subscription_id
--             AND billing_period_start = v_billing_period_start
--             AND billing_period_end = v_billing_period_end;
        
--         v_subscription_available := v_reports_included - COALESCE(v_subscription_available, 0);
        
--         -- Use subscription if available
--         IF v_subscription_available > 0 THEN
--             v_usage_type := 'subscription_included';
            
--             -- Update subscription usage
--             UPDATE public.subscription_usage_summary
--             SET reports_used = reports_used + 1,
--                 updated_at = NOW()
--             WHERE subscription_id = v_active_subscription_id
--                 AND billing_period_start = v_billing_period_start
--                 AND billing_period_end = v_billing_period_end;
            
--             -- Record usage
--             INSERT INTO public.report_usage (
--                 user_id,
--                 inspection_id,
--                 report_id,
--                 usage_type,
--                 subscription_id,
--                 had_history,
--                 billing_period_start,
--                 billing_period_end
--             ) VALUES (
--                 p_user_id,
--                 p_inspection_id,
--                 p_report_id,
--                 v_usage_type,
--                 v_active_subscription_id,
--                 p_had_history,
--                 v_billing_period_start,
--                 v_billing_period_end
--             );
            
--             v_remaining := v_subscription_available - 1;
            
--             RETURN QUERY SELECT 
--                 true::BOOLEAN,
--                 v_usage_type::TEXT,
--                 'Report deducted from subscription'::TEXT,
--                 v_remaining::INTEGER;
--             RETURN;
--         END IF;
--     END IF;
    
--     -- Try to use report block (oldest expiring first)
--     SELECT rb.id
--     INTO v_report_block_id
--     FROM public.report_blocks rb
--     INNER JOIN public.report_block_types rbt ON rb.report_block_type_id = rbt.id
--     WHERE rb.user_id = p_user_id
--         AND rb.is_active = true
--         AND rb.reports_used < rb.reports_total
--         AND rb.expiry_date > NOW()
--         AND (rbt.with_history = true OR p_had_history = false)
--     ORDER BY rb.expiry_date ASC, rb.created_at ASC
--     LIMIT 1;
    
--     IF v_report_block_id IS NOT NULL THEN
--         v_usage_type := 'block';
        
--         -- Update block usage
--         UPDATE public.report_blocks
--         SET reports_used = reports_used + 1,
--             updated_at = NOW()
--         WHERE id = v_report_block_id;
        
--         -- Record usage
--         INSERT INTO public.report_usage (
--             user_id,
--             inspection_id,
--             report_id,
--             usage_type,
--             report_block_id,
--             had_history
--         ) VALUES (
--             p_user_id,
--             p_inspection_id,
--             p_report_id,
--             v_usage_type,
--             v_report_block_id,
--             p_had_history
--         );
        
--         -- Calculate remaining from all blocks
--         SELECT COALESCE(SUM(reports_total - reports_used), 0)
--         INTO v_remaining
--         FROM public.report_blocks
--         WHERE user_id = p_user_id
--             AND is_active = true
--             AND reports_used < reports_total
--             AND expiry_date > NOW();
        
--         RETURN QUERY SELECT 
--             true::BOOLEAN,
--             v_usage_type::TEXT,
--             'Report deducted from block'::TEXT,
--             v_remaining::INTEGER;
--         RETURN;
--     END IF;
    
--     -- No available reports
--     RETURN QUERY SELECT 
--         false::BOOLEAN,
--         'insufficient'::TEXT,
--         'No available reports. Please purchase more.'::TEXT,
--         0::INTEGER;
-- END;
-- $$;

-- -- ============================================================================
-- -- 5. Create function to reset subscription usage at period end
-- -- ============================================================================
-- CREATE OR REPLACE FUNCTION public.reset_subscription_usage()
-- RETURNS void
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- BEGIN
--     -- Create new usage summaries for active subscriptions starting a new period
--     INSERT INTO public.subscription_usage_summary (
--         subscription_id,
--         billing_period_start,
--         billing_period_end,
--         reports_included,
--         reports_used,
--         last_reset_date
--     )
--     SELECT 
--         s.id,
--         s.current_period_start::DATE,
--         s.current_period_end::DATE,
--         COALESCE(p.included_reports, 0),
--         0,
--         NOW()
--     FROM public.subscriptions s
--     INNER JOIN public.plans p ON s.plan_id = p.id
--     WHERE s.status = 'active'
--         AND s.current_period_start::DATE = CURRENT_DATE
--     ON CONFLICT (subscription_id, billing_period_start, billing_period_end) 
--     DO UPDATE SET 
--         last_reset_date = NOW(),
--         updated_at = NOW();
-- END;
-- $$;

-- -- ============================================================================
-- -- 6. Create cron job to reset usage daily (runs at 00:05 UTC)
-- -- ============================================================================
-- SELECT cron.schedule(
--     'reset-subscription-usage-daily',
--     '5 0 * * *',
--     $$SELECT public.reset_subscription_usage();$$
-- );

-- -- ============================================================================
-- -- 7. Grant permissions
-- -- ============================================================================
-- GRANT SELECT ON TABLE public.report_usage TO authenticated;
-- GRANT SELECT ON TABLE public.subscription_usage_summary TO authenticated;
-- GRANT ALL ON TABLE public.report_usage TO service_role;
-- GRANT ALL ON TABLE public.subscription_usage_summary TO service_role;

-- GRANT EXECUTE ON FUNCTION public.get_user_available_reports(UUID) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_user_available_reports(UUID) TO service_role;
-- GRANT EXECUTE ON FUNCTION public.record_report_usage(UUID, UUID, UUID, BOOLEAN) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.record_report_usage(UUID, UUID, UUID, BOOLEAN) TO service_role;
-- GRANT EXECUTE ON FUNCTION public.reset_subscription_usage() TO service_role;

-- -- ============================================================================
-- -- 8. Enable RLS
-- -- ============================================================================
-- ALTER TABLE public.report_usage ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.subscription_usage_summary ENABLE ROW LEVEL SECURITY;

-- -- RLS Policies for report_usage
-- CREATE POLICY "Users can view own report usage"
-- ON public.report_usage
-- FOR SELECT
-- USING (auth.uid() = user_id);

-- CREATE POLICY "Service role full access to report usage"
-- ON public.report_usage
-- FOR ALL
-- USING (true)
-- WITH CHECK (true);

-- -- RLS Policies for subscription_usage_summary
-- CREATE POLICY "Users can view own subscription usage summary"
-- ON public.subscription_usage_summary
-- FOR SELECT
-- USING (
--     EXISTS (
--         SELECT 1 FROM public.subscriptions
--         WHERE subscriptions.id = subscription_usage_summary.subscription_id
--         AND subscriptions.user_id = auth.uid()
--     )
-- );

-- CREATE POLICY "Service role full access to subscription usage summary"
-- ON public.subscription_usage_summary
-- FOR ALL
-- USING (true)
-- WITH CHECK (true);

-- ============================================================================
-- 9. Add helpful comments
-- ============================================================================
COMMENT ON TABLE public.report_usage IS 'Tracks every report consumption with deduction source (subscription/block/pay-per-report)';
COMMENT ON COLUMN public.report_usage.usage_type IS 'How the report was paid for: subscription_included, block, pay_per_report, free_trial';
COMMENT ON COLUMN public.report_usage.had_history IS 'Whether this report included vehicle history lookup';
COMMENT ON COLUMN public.report_usage.billing_period_start IS 'Subscription billing period start (if applicable)';
COMMENT ON COLUMN public.report_usage.billing_period_end IS 'Subscription billing period end (if applicable)';

COMMENT ON TABLE public.subscription_usage_summary IS 'Aggregated subscription usage per billing period for quick lookups';
COMMENT ON COLUMN public.subscription_usage_summary.reports_included IS 'Number of reports included in subscription for this period';
COMMENT ON COLUMN public.subscription_usage_summary.reports_used IS 'Number of reports consumed from subscription in this period';
COMMENT ON COLUMN public.subscription_usage_summary.reports_remaining IS 'Auto-calculated remaining reports (included - used)';
COMMENT ON COLUMN public.subscription_usage_summary.last_reset_date IS 'Last time usage was reset for new billing period';

-- COMMENT ON FUNCTION public.get_user_available_reports(UUID) IS 'Returns total available reports across subscription and blocks for a user';
-- COMMENT ON FUNCTION public.record_report_usage(UUID, UUID, UUID, BOOLEAN) IS 'Records report usage and deducts from subscription or block (FIFO expiry for blocks)';
-- COMMENT ON FUNCTION public.reset_subscription_usage() IS 'Resets subscription usage counters at the start of new billing periods';
