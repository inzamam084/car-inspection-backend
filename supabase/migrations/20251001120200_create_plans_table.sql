-- Migration: Create plans table
-- Description: Define subscription plans with pricing and features

CREATE TABLE public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    monthly_fee NUMERIC(10,2) NOT NULL,
    annual_fee NUMERIC(10,2) NOT NULL,
    included_reports INTEGER NOT NULL DEFAULT 0,
    extra_report_price NUMERIC(10,2),
    history_addon_price NUMERIC(10,2),
    included_seats INTEGER NOT NULL DEFAULT 1,
    extra_seat_price NUMERIC(10,2),
    stripe_price_id_monthly TEXT,
    stripe_price_id_annual TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Ensure fees are non-negative
    CONSTRAINT plans_monthly_fee_check CHECK (monthly_fee >= 0),
    CONSTRAINT plans_annual_fee_check CHECK (annual_fee >= 0),
    CONSTRAINT plans_included_reports_check CHECK (included_reports >= 0),
    CONSTRAINT plans_included_seats_check CHECK (included_seats >= 1)
);

-- Create indexes for better performance
CREATE INDEX idx_plans_name ON public.plans(name);
CREATE INDEX idx_plans_is_active ON public.plans(is_active);
CREATE INDEX idx_plans_stripe_price_monthly ON public.plans(stripe_price_id_monthly);
CREATE INDEX idx_plans_stripe_price_annual ON public.plans(stripe_price_id_annual);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_plans_updated_at
    BEFORE UPDATE ON public.plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT ON TABLE public.plans TO anon;
GRANT SELECT ON TABLE public.plans TO authenticated;
GRANT ALL ON TABLE public.plans TO service_role;

-- Add comments for documentation
COMMENT ON TABLE public.plans IS 'Subscription plans with pricing and feature limits';
COMMENT ON COLUMN public.plans.name IS 'Human readable plan name (Starter, Pro, Dealer, Elite)';
COMMENT ON COLUMN public.plans.monthly_fee IS 'Monthly subscription charge in USD';
COMMENT ON COLUMN public.plans.annual_fee IS 'Annual prepaid price (typically 10x monthly for savings)';
COMMENT ON COLUMN public.plans.included_reports IS 'Number of reports included in plan (e.g. 4, 25, 80, 130)';
COMMENT ON COLUMN public.plans.extra_report_price IS 'Price for additional single reports beyond plan allowance';
COMMENT ON COLUMN public.plans.history_addon_price IS 'Monthly price for history add-on feature';
COMMENT ON COLUMN public.plans.included_seats IS 'Default number of seats included (usually 1)';
COMMENT ON COLUMN public.plans.extra_seat_price IS 'Per-seat monthly price (e.g. $15/month)';
COMMENT ON COLUMN public.plans.stripe_price_id_monthly IS 'Stripe Price ID for monthly billing';
COMMENT ON COLUMN public.plans.stripe_price_id_annual IS 'Stripe Price ID for annual billing';
COMMENT ON COLUMN public.plans.is_active IS 'Whether this plan is currently available for new subscriptions';
