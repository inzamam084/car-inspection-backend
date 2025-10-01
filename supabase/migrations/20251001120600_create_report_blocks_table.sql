-- Migration: Create report_blocks table
-- Description: Track purchased report blocks, usage, and expiry (90 days from purchase)

CREATE TABLE public.report_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    report_block_type_id UUID NOT NULL REFERENCES public.report_block_types(id) ON DELETE RESTRICT,
    reports_total INTEGER NOT NULL,
    reports_used INTEGER NOT NULL DEFAULT 0,
    purchase_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
    stripe_payment_intent_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Ensure reports_used never exceeds reports_total
    CONSTRAINT report_blocks_usage_check CHECK (reports_used <= reports_total),
    
    -- Ensure reports_used is non-negative
    CONSTRAINT report_blocks_reports_used_check CHECK (reports_used >= 0),
    
    -- Ensure reports_total is positive
    CONSTRAINT report_blocks_reports_total_check CHECK (reports_total > 0)
);

-- Create indexes for better performance
CREATE INDEX idx_report_blocks_user_id ON public.report_blocks(user_id);
CREATE INDEX idx_report_blocks_report_block_type_id ON public.report_blocks(report_block_type_id);
CREATE INDEX idx_report_blocks_stripe_payment_intent_id ON public.report_blocks(stripe_payment_intent_id);
CREATE INDEX idx_report_blocks_expiry_date ON public.report_blocks(expiry_date);
CREATE INDEX idx_report_blocks_is_active ON public.report_blocks(is_active);
CREATE INDEX idx_report_blocks_purchase_date ON public.report_blocks(purchase_date DESC);

-- Create composite index for finding available blocks
CREATE INDEX idx_report_blocks_user_active_expiry ON public.report_blocks(user_id, is_active, expiry_date)
WHERE reports_used < reports_total;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_report_blocks_updated_at
    BEFORE UPDATE ON public.report_blocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to automatically set expiry_date to 90 days from purchase
CREATE OR REPLACE FUNCTION set_report_block_expiry()
RETURNS TRIGGER AS $$
BEGIN
    -- Set expiry_date to 90 days from purchase_date
    IF NEW.expiry_date IS NULL OR NEW.expiry_date = NEW.purchase_date THEN
        NEW.expiry_date := NEW.purchase_date + INTERVAL '90 days';
    END IF;
    
    -- Auto-deactivate if fully used
    IF NEW.reports_used >= NEW.reports_total THEN
        NEW.is_active := false;
    END IF;
    
    -- Auto-deactivate if expired
    IF NEW.expiry_date <= NOW() THEN
        NEW.is_active := false;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to set expiry_date on insert and update
CREATE TRIGGER set_report_block_expiry_trigger
    BEFORE INSERT OR UPDATE ON public.report_blocks
    FOR EACH ROW
    EXECUTE FUNCTION set_report_block_expiry();

-- Grant permissions
GRANT SELECT ON TABLE public.report_blocks TO authenticated;
GRANT ALL ON TABLE public.report_blocks TO service_role;

-- Enable RLS
ALTER TABLE public.report_blocks ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view their own report blocks
CREATE POLICY "Users can view own report blocks"
ON public.report_blocks
FOR SELECT
USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role full access to report blocks"
ON public.report_blocks
FOR ALL
USING (true)
WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE public.report_blocks IS 'Purchased report blocks with usage tracking and 90-day expiry';
COMMENT ON COLUMN public.report_blocks.user_id IS 'Block owner (references profiles.id)';
COMMENT ON COLUMN public.report_blocks.report_block_type_id IS 'Type of block purchased (references report_block_types.id)';
COMMENT ON COLUMN public.report_blocks.reports_total IS 'Total number of reports in block (e.g. 5, 10, 20, 50)';
COMMENT ON COLUMN public.report_blocks.reports_used IS 'Number of reports consumed from this block';
COMMENT ON COLUMN public.report_blocks.purchase_date IS 'When the block was purchased';
COMMENT ON COLUMN public.report_blocks.expiry_date IS 'Block expiry date (90 days from purchase_date)';
COMMENT ON COLUMN public.report_blocks.stripe_payment_intent_id IS 'Stripe payment intent/charge ID';
COMMENT ON COLUMN public.report_blocks.is_active IS 'False if fully used or expired';