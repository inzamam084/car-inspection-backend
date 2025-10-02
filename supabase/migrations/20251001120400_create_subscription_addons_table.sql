-- Migration: Create subscription_addons table
-- Description: Manage additional subscription features like extra seats or history add-ons

CREATE TABLE public.subscription_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    addon_type TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price_per_unit NUMERIC(10,2) NOT NULL,
    stripe_item_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Ensure quantity is positive
    CONSTRAINT subscription_addons_quantity_check CHECK (quantity > 0),
    CONSTRAINT subscription_addons_price_check CHECK (price_per_unit >= 0),

    -- Ensure addon_type is one of the allowed values (extensible)
    CONSTRAINT subscription_addons_type_check CHECK (addon_type IN ('history', 'seat', 'extra_report'))
);

-- Create indexes for better performance
CREATE INDEX idx_subscription_addons_subscription_id ON public.subscription_addons(subscription_id);
CREATE INDEX idx_subscription_addons_addon_type ON public.subscription_addons(addon_type);
CREATE INDEX idx_subscription_addons_stripe_item_id ON public.subscription_addons(stripe_item_id);
CREATE INDEX idx_subscription_addons_is_active ON public.subscription_addons(is_active);

-- Create composite index for common queries
CREATE INDEX idx_subscription_addons_subscription_type ON public.subscription_addons(subscription_id, addon_type);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_subscription_addons_updated_at
    BEFORE UPDATE ON public.subscription_addons
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT ON TABLE public.subscription_addons TO authenticated;
GRANT ALL ON TABLE public.subscription_addons TO service_role;

-- Enable RLS
ALTER TABLE public.subscription_addons ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view addons for their own subscriptions
CREATE POLICY "Users can view own subscription addons"
ON public.subscription_addons
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE subscriptions.id = subscription_addons.subscription_id
        AND subscriptions.user_id = auth.uid()
    )
);

-- Service role has full access
CREATE POLICY "Service role full access to subscription addons"
ON public.subscription_addons
FOR ALL
USING (true)
WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE public.subscription_addons IS 'Additional subscription features like extra seats or history add-ons';
COMMENT ON COLUMN public.subscription_addons.subscription_id IS 'Parent subscription (references subscriptions.id)';
COMMENT ON COLUMN public.subscription_addons.addon_type IS 'Type of addon: history, seat, extra_report (extensible)';
COMMENT ON COLUMN public.subscription_addons.quantity IS 'Number of units (e.g. number of extra seats)';
COMMENT ON COLUMN public.subscription_addons.price_per_unit IS 'Price per unit for billing (mirrors plan pricing)';
COMMENT ON COLUMN public.subscription_addons.stripe_item_id IS 'Stripe subscription item ID for this addon';
COMMENT ON COLUMN public.subscription_addons.is_active IS 'Whether this addon is currently active';
