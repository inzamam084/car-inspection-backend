-- Migration: Create seats table
-- Description: Seat management for subscriptions (future-proofed for team collaboration)

CREATE TABLE public.seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'invited',
    assigned_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    invited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMP WITH TIME ZONE,
    removed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Ensure status is one of the allowed values
    CONSTRAINT seats_status_check CHECK (status IN ('invited', 'active', 'removed', 'expired')),
    
    -- Ensure email is valid format (basic check)
    -- CONSTRAINT seats_email_check CHECK (user_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    
    -- Unique constraint: one email can only have one seat per subscription
    CONSTRAINT seats_unique_email_subscription UNIQUE (subscription_id, user_email)
);

-- Create indexes for better performance
CREATE INDEX idx_seats_subscription_id ON public.seats(subscription_id);
CREATE INDEX idx_seats_user_email ON public.seats(user_email);
CREATE INDEX idx_seats_status ON public.seats(status);
CREATE INDEX idx_seats_assigned_user_id ON public.seats(assigned_user_id);
CREATE INDEX idx_seats_invited_by ON public.seats(invited_by);

-- Create composite index for common queries
CREATE INDEX idx_seats_subscription_status ON public.seats(subscription_id, status);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_seats_updated_at
    BEFORE UPDATE ON public.seats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT ON TABLE public.seats TO authenticated;
GRANT ALL ON TABLE public.seats TO service_role;

-- Enable RLS
ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view seats for their own subscriptions (as owners)
CREATE POLICY "Subscription owners can view seats"
ON public.seats
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE subscriptions.id = seats.subscription_id
        AND subscriptions.user_id = auth.uid()
    )
);

-- Users can view seats where they are the assigned user
CREATE POLICY "Assigned users can view their own seat"
ON public.seats
FOR SELECT
USING (assigned_user_id = auth.uid());

-- Users can view seats where they were invited (by email)
CREATE POLICY "Invited users can view their invitation"
ON public.seats
FOR SELECT
USING (
    user_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
);

-- Subscription owners can manage seats
CREATE POLICY "Subscription owners can manage seats"
ON public.seats
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE subscriptions.id = seats.subscription_id
        AND subscriptions.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE subscriptions.id = seats.subscription_id
        AND subscriptions.user_id = auth.uid()
    )
);

-- Service role has full access
CREATE POLICY "Service role full access to seats"
ON public.seats
FOR ALL
USING (true)
WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE public.seats IS 'Seat management for team collaboration on subscriptions';
COMMENT ON COLUMN public.seats.subscription_id IS 'Parent subscription (references subscriptions.id)';
COMMENT ON COLUMN public.seats.user_email IS 'Email of invited/assigned team member';
COMMENT ON COLUMN public.seats.status IS 'Seat status: invited, active, removed, expired';
COMMENT ON COLUMN public.seats.assigned_user_id IS 'User ID once invitation is accepted (nullable until accepted)';
COMMENT ON COLUMN public.seats.invited_by IS 'User who sent the invitation';
COMMENT ON COLUMN public.seats.invited_at IS 'When the invitation was sent';
COMMENT ON COLUMN public.seats.accepted_at IS 'When the invitation was accepted';
COMMENT ON COLUMN public.seats.removed_at IS 'When the seat was removed/revoked';