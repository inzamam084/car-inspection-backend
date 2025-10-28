-- Migration: Handle registration token on user signup
-- Description: When a new user signs up with a registration token, mark the token as used and create Trial subscription
-- Compatible with subscription-utils.ts and subscription-middleware.ts

-- Function to handle new user signup with registration token
CREATE OR REPLACE FUNCTION public.handle_new_user_with_registration_token()
RETURNS TRIGGER AS $$
DECLARE
  v_registration_token TEXT;
  v_token_record RECORD;
  v_trial_days INTEGER;
  v_trial_plan_id UUID;
  v_billing_period_start DATE;
  v_billing_period_end DATE;
BEGIN
  -- Extract registration token from user metadata
  v_registration_token := NEW.raw_user_meta_data->>'registration_token';
  
  -- If no registration token, exit early
  IF v_registration_token IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the token record from registration_tokens table
  SELECT * INTO v_token_record
  FROM public.registration_tokens
  WHERE token = v_registration_token
    AND status = 'active'
    AND expires_at > NOW();

  -- If token not found or invalid, exit (user can still sign up but won't get trial)
  IF NOT FOUND THEN
    RAISE NOTICE 'Registration token % not found or invalid for user %', v_registration_token, NEW.id;
    RETURN NEW;
  END IF;

  -- Mark token as used
  UPDATE public.registration_tokens
  SET 
    status = 'used',
    used_at = NOW(),
    updated_at = NOW()
  WHERE token = v_registration_token;

  RAISE NOTICE 'Marked registration token % as used for user %', v_registration_token, NEW.id;

  -- Extract trial duration from token metadata (default 7 days)
  v_trial_days := COALESCE((v_token_record.metadata->>'trial_days')::INTEGER, 7);

  -- Get the Trial plan ID from plans table
  SELECT id INTO v_trial_plan_id
  FROM public.plans
  WHERE name = 'Trial'
    AND is_active = true
  LIMIT 1;

  -- If Trial plan doesn't exist, log and exit
  IF v_trial_plan_id IS NULL THEN
    RAISE WARNING 'Trial plan not found in plans table for user %', NEW.id;
    RETURN NEW;
  END IF;

  -- Calculate billing period
  v_billing_period_start := CURRENT_DATE;
  v_billing_period_end := CURRENT_DATE + (v_trial_days || ' days')::INTERVAL;

  -- Create Trial subscription for the user
  INSERT INTO public.subscriptions (
    user_id,
    plan_id,
    status,
    current_period_start,
    current_period_end,
    stripe_subscription_id,
    is_annual,
    start_date,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    v_trial_plan_id,                    -- Trial plan UUID from plans table
    'active',                            -- Status is 'active' (required by subscription-utils.ts)
    NOW(),                               -- current_period_start
    NOW() + (v_trial_days || ' days')::INTERVAL,  -- current_period_end
    NULL,                                -- No Stripe subscription for trials
    false,                               -- Not annual
    v_billing_period_start,              -- Start date
    NOW(),
    NOW()
  );

  RAISE NOTICE 'Created Trial subscription for user % with token % (expires in % days)', NEW.id, v_registration_token, v_trial_days;

  -- Create initial usage summary record for the trial period
  -- This ensures subscription-utils.ts can track usage correctly
  INSERT INTO public.subscription_usage_summary (
    subscription_id,
    billing_period_start,
    billing_period_end,
    reports_included,
    reports_used,
    created_at,
    updated_at
  )
  SELECT
    s.id,
    v_billing_period_start,
    v_billing_period_end,
    p.included_reports,
    0,  -- Start with 0 reports used
    NOW(),
    NOW()
  FROM public.subscriptions s
  JOIN public.plans p ON s.plan_id = p.id
  WHERE s.user_id = NEW.id
    AND s.plan_id = v_trial_plan_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  RAISE NOTICE 'Created usage summary for Trial subscription for user %', NEW.id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't fail the user creation
    RAISE WARNING 'Error processing registration token for user %: % (SQLSTATE: %)', NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists (for migration re-runs)
DROP TRIGGER IF EXISTS on_auth_user_created_with_token ON auth.users;

-- Create trigger on auth.users table
CREATE TRIGGER on_auth_user_created_with_token
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_with_registration_token();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.handle_new_user_with_registration_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user_with_registration_token() TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION public.handle_new_user_with_registration_token() IS 
'Handles new user signup with registration token. Marks token as used, creates Trial plan subscription (from plans table), and initializes usage tracking for compatibility with subscription-utils.ts and subscription-middleware.ts.';

COMMENT ON TRIGGER on_auth_user_created_with_token ON auth.users IS 
'Automatically processes registration tokens when new users sign up, creating Trial subscriptions with proper usage tracking and marking tokens as used.';