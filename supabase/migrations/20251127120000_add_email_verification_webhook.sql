-- Add welcome email tracking fields to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS welcome_email_sent boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamp with time zone;

-- Create index for email verification tracking
CREATE INDEX IF NOT EXISTS idx_profiles_welcome_email_sent 
ON public.profiles(welcome_email_sent);

-- Enable pg_net extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA net TO postgres, anon, authenticated, service_role;

-- Create a function to handle email verification events
CREATE OR REPLACE FUNCTION public.handle_email_verified()
RETURNS TRIGGER AS $$
DECLARE
  request_id bigint;
  payload jsonb;
  supabase_url text;
  supabase_anon_key text;
  headers jsonb;
BEGIN
  -- Only process if email_confirmed_at changed from NULL to a value
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    
    BEGIN
      -- Fetch credentials from Vault (consistent with other trigger functions in the project)
      SELECT decrypted_secret INTO supabase_url
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_URL';
      
      SELECT decrypted_secret INTO supabase_anon_key
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_ANON_KEY';
      
      -- Check if credentials were found
      IF supabase_url IS NULL OR supabase_anon_key IS NULL THEN
        RAISE WARNING 'Could not fetch SUPABASE_URL or SUPABASE_ANON_KEY from Vault';
        RETURN NEW;
      END IF;
      
      -- Prepare the payload
      payload := jsonb_build_object(
        'event', 'email_verified',
        'user_id', NEW.id,
        'email', NEW.email,
        'verified_at', NEW.email_confirmed_at
      );
      
      -- Prepare headers with anon key for authentication
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || supabase_anon_key
      );
      
      -- Use pg_net to make HTTP request to the edge function
      SELECT net.http_post(
        url := supabase_url || '/functions/v1/on-email-verified',
        body := payload,
        headers := headers
      ) INTO request_id;
      
      -- Log event to console (optional)
      RAISE NOTICE 'Email verification webhook triggered for user % with request_id %', NEW.email, request_id;
      
    EXCEPTION
      WHEN OTHERS THEN
        -- Log error but don't fail the trigger
        RAISE WARNING 'Failed to trigger email verification webhook: %', SQLERRM;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users table for email verification
DROP TRIGGER IF EXISTS on_email_verified ON auth.users;
CREATE TRIGGER on_email_verified
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
  EXECUTE FUNCTION public.handle_email_verified();

-- Add comment to document the webhook
COMMENT ON FUNCTION public.handle_email_verified() IS 
  'Triggers the on-email-verified Edge Function when a user verifies their email address.
   Fetches SUPABASE_URL and SUPABASE_ANON_KEY from Vault for environment-specific configuration.';
