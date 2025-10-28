-- Migration: Handle registration token on user signup
-- Description: Extends existing handle_new_user() function to process registration tokens
-- This modifies the existing trigger function to add token handling

-- Function to process registration token (called by handle_new_user)
CREATE OR REPLACE FUNCTION public.process_registration_token(p_user_id UUID, p_user_metadata JSONB)
RETURNS VOID AS $$
DECLARE
  v_registration_token TEXT;
  v_token_record RECORD;
  v_trial_days INTEGER;
  v_trial_plan_id UUID;
  v_billing_period_start DATE;
  v_billing_period_end DATE;
BEGIN
  -- Extract registration token from user metadata
  v_registration_token := p_user_metadata->>'registration_token';
  
  -- If no registration token, exit early
  IF v_registration_token IS NULL THEN
    RETURN;
  END IF;

  -- Get the token record from registration_tokens table
  SELECT * INTO v_token_record
  FROM public.registration_tokens
  WHERE token = v_registration_token
    AND status = 'active'
    AND expires_at > NOW();

  -- If token not found or invalid, exit
  IF NOT FOUND THEN
    RAISE NOTICE 'Registration token % not found or invalid for user %', v_registration_token, p_user_id;
    RETURN;
  END IF;

  -- Mark token as used
  UPDATE public.registration_tokens
  SET 
    status = 'used',
    used_at = NOW(),
    updated_at = NOW()
  WHERE token = v_registration_token;

  RAISE NOTICE 'Marked registration token % as used for user %', v_registration_token, p_user_id;

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
    RAISE WARNING 'Trial plan not found in plans table for user %', p_user_id;
    RETURN;
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
    p_user_id,
    v_trial_plan_id,
    'active',
    NOW(),
    NOW() + (v_trial_days || ' days')::INTERVAL,
    NULL,
    false,
    v_billing_period_start,
    NOW(),
    NOW()
  );

  RAISE NOTICE 'Created Trial subscription for user % with token % (expires in % days)', p_user_id, v_registration_token, v_trial_days;

  -- Create initial usage summary record for the trial period
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
    0,
    NOW(),
    NOW()
  FROM public.subscriptions s
  JOIN public.plans p ON s.plan_id = p.id
  WHERE s.user_id = p_user_id
    AND s.plan_id = v_trial_plan_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  RAISE NOTICE 'Created usage summary for Trial subscription for user %', p_user_id;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error processing registration token for user %: % (SQLSTATE: %)', p_user_id, SQLERRM, SQLSTATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the existing handle_new_user function to call our token processor
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Create profile (original functionality)
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email);
    
    -- Process registration token if present
    PERFORM public.process_registration_token(NEW.id, NEW.raw_user_meta_data);
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error and continue (prevents failed profile creation from blocking user signup)
        INSERT INTO public.function_logs (function_name, error_message, record_id)
        VALUES ('handle_new_user', SQLERRM, NEW.id);
        RETURN NEW;
END;
$$ LANGUAGE 'plpgsql' SECURITY DEFINER;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.process_registration_token(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_registration_token(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_registration_token(UUID, JSONB) TO anon;

-- Add comments for documentation
COMMENT ON FUNCTION public.process_registration_token(UUID, JSONB) IS 
'Processes registration tokens when new users sign up. Marks token as used, creates Trial plan subscription, and initializes usage tracking.';

COMMENT ON FUNCTION public.handle_new_user() IS 
'Handles new user signup by creating profile and processing registration token if present.';