-- Migration: Remove stripe_customer_id from subscriptions table
-- Description: Remove duplicate stripe_customer_id field as it's now stored in profiles table only

-- First, check if there are any subscriptions that have stripe_customer_id but user doesn't have it in profiles
-- This will help us migrate data if needed
DO $$
BEGIN
    -- Update profiles with stripe_customer_id from subscriptions where profiles don't have it
    UPDATE public.profiles p
    SET stripe_customer_id = s.stripe_customer_id
    FROM public.subscriptions s
    WHERE p.id = s.user_id 
    AND p.stripe_customer_id IS NULL 
    AND s.stripe_customer_id IS NOT NULL;
    
    -- Log how many records were updated
    RAISE NOTICE 'Migrated stripe_customer_id from subscriptions to profiles for % users', 
        (SELECT COUNT(*) FROM public.subscriptions s 
         JOIN public.profiles p ON p.id = s.user_id 
         WHERE s.stripe_customer_id IS NOT NULL);
END $$;

-- Now safely drop the column from subscriptions
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS stripe_customer_id;

-- Add comment to document the change
COMMENT ON TABLE public.subscriptions IS 'User subscriptions - stripe_customer_id is stored in profiles table to avoid duplication';
