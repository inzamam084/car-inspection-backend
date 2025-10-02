-- Migration: Create payments table
-- Description: Mirror Stripe payments for reconciliation and reporting

CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    stripe_payment_intent_id TEXT NOT NULL UNIQUE,
    amount NUMERIC(10,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL,
    type TEXT NOT NULL,
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    report_block_id UUID REFERENCES public.report_blocks(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Ensure status is one of the allowed values
    CONSTRAINT payments_status_check CHECK (status IN ('succeeded', 'pending', 'failed', 'refunded', 'canceled')),
    
    -- Ensure type is one of the allowed values
    CONSTRAINT payments_type_check CHECK (type IN ('subscription', 'block', 'addon', 'seat')),
    
    -- Ensure amount is non-negative
    CONSTRAINT payments_amount_check CHECK (amount >= 0),
    
    -- Ensure currency is valid ISO code (3 characters)
    CONSTRAINT payments_currency_check CHECK (LENGTH(currency) = 3)
);

-- Create indexes for better performance
CREATE INDEX idx_payments_user_id ON public.payments(user_id);
CREATE INDEX idx_payments_stripe_payment_intent_id ON public.payments(stripe_payment_intent_id);
CREATE INDEX idx_payments_status ON public.payments(status);
CREATE INDEX idx_payments_type ON public.payments(type);
CREATE INDEX idx_payments_subscription_id ON public.payments(subscription_id);
CREATE INDEX idx_payments_report_block_id ON public.payments(report_block_id);
CREATE INDEX idx_payments_created_at ON public.payments(created_at DESC);

-- Create composite index for common queries
CREATE INDEX idx_payments_user_status_type ON public.payments(user_id, status, type);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;

-- Enable RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view their own payments
CREATE POLICY "Users can view own payments"
ON public.payments
FOR SELECT
USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role full access to payments"
ON public.payments
FOR ALL
USING (true)
WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE public.payments IS 'Payment records mirroring Stripe payments for reconciliation and reporting';
COMMENT ON COLUMN public.payments.user_id IS 'User who made the payment (references profiles.id)';
COMMENT ON COLUMN public.payments.stripe_payment_intent_id IS 'Stripe Payment Intent ID for reconciliation';
COMMENT ON COLUMN public.payments.amount IS 'Payment amount in decimal (e.g. 99.99)';
COMMENT ON COLUMN public.payments.currency IS 'ISO 4217 currency code (e.g. usd, eur, gbp)';
COMMENT ON COLUMN public.payments.status IS 'Payment status: succeeded, pending, failed, refunded, canceled';
COMMENT ON COLUMN public.payments.type IS 'Payment type: subscription, block, addon, seat';
COMMENT ON COLUMN public.payments.subscription_id IS 'Related subscription if payment is for subscription';
COMMENT ON COLUMN public.payments.report_block_id IS 'Related report block if payment is for block purchase';
COMMENT ON COLUMN public.payments.metadata IS 'Additional payment metadata in JSON format';