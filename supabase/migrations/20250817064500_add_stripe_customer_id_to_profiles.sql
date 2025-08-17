-- Add stripe_customer_id column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN stripe_customer_id text UNIQUE;

-- Create index on stripe_customer_id for faster lookups
CREATE INDEX idx_profiles_stripe_customer_id ON public.profiles(stripe_customer_id);

-- Add comment to document the column purpose
COMMENT ON COLUMN public.profiles.stripe_customer_id IS 'Stripe customer ID for billing and subscription management';
