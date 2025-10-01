-- Migration: Create report_block_types table
-- Description: Define catalog pricing per plan, per size, with/without history options

CREATE TABLE public.report_block_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
    block_size INTEGER NOT NULL,
    with_history BOOLEAN NOT NULL DEFAULT false,
    price NUMERIC(10,2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Ensure block_size is one of the allowed values
    -- CONSTRAINT report_block_types_block_size_check CHECK (block_size IN (5, 10, 20, 50)),

    -- Ensure price is non-negative
    CONSTRAINT report_block_types_price_check CHECK (price >= 0),

    -- Ensure unique combination of plan, size, and history option
    CONSTRAINT report_block_types_unique_combo UNIQUE (plan_id, block_size, with_history)
);

-- Create indexes for better performance
CREATE INDEX idx_report_block_types_plan_id ON public.report_block_types(plan_id);
CREATE INDEX idx_report_block_types_block_size ON public.report_block_types(block_size);
CREATE INDEX idx_report_block_types_with_history ON public.report_block_types(with_history);
CREATE INDEX idx_report_block_types_is_active ON public.report_block_types(is_active);

-- Create composite index for common queries
CREATE INDEX idx_report_block_types_plan_size_history ON public.report_block_types(plan_id, block_size, with_history);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_report_block_types_updated_at
    BEFORE UPDATE ON public.report_block_types
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT ON TABLE public.report_block_types TO anon;
GRANT SELECT ON TABLE public.report_block_types TO authenticated;
GRANT ALL ON TABLE public.report_block_types TO service_role;

-- Add comments for documentation
COMMENT ON TABLE public.report_block_types IS 'Catalog pricing for report blocks: per-plan, per-size, with/without history';
COMMENT ON COLUMN public.report_block_types.plan_id IS 'Which plan this block pricing belongs to';
COMMENT ON COLUMN public.report_block_types.block_size IS 'Number of reports in block: 5, 10, 20, or 50';
COMMENT ON COLUMN public.report_block_types.with_history IS 'false = inspection-only, true = inspection+history';
COMMENT ON COLUMN public.report_block_types.price IS 'Block price in USD for this plan and configuration';
COMMENT ON COLUMN public.report_block_types.is_active IS 'Whether this block type is currently available for purchase';
COMMENT ON COLUMN public.report_block_types.created_at IS 'Record creation timestamp';
COMMENT ON COLUMN public.report_block_types.updated_at IS 'Record last update timestamp';