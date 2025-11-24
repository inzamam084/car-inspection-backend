-- Migration: Add trigger to send email notifications when inspection status changes to done or failed
-- Created: 2025-01-24

-- Create function to send email notification via run-inspection/email/send endpoint
CREATE OR REPLACE FUNCTION notify_inspection_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_service_role_key TEXT;
  v_supabase_url TEXT;
  v_response RECORD;
BEGIN
  -- Only trigger for status changes to 'done' or 'failed'
  -- Also check that status actually changed (not just an update to other fields)
  IF (NEW.status = 'done' OR NEW.status = 'failed')
     AND (OLD.status IS NULL OR OLD.status != NEW.status) THEN

    -- Get Supabase URL and service role key from vault
    SELECT decrypted_secret INTO v_supabase_url
    FROM vault.decrypted_secrets
    WHERE name = 'SUPABASE_URL';

    SELECT decrypted_secret INTO v_service_role_key
    FROM vault.decrypted_secrets
    WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';

    -- Validate that we have the required credentials
    IF v_supabase_url IS NULL OR v_service_role_key IS NULL THEN
      RAISE WARNING 'Missing Supabase credentials in vault for email notification';
      RETURN NEW;
    END IF;

    -- Call the email endpoint asynchronously using pg_net
    SELECT status, content INTO v_response
    FROM net.http_post(
      url := v_supabase_url || '/functions/v1/run-inspection/email/send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      body := jsonb_build_object(
        'inspection_id', NEW.id,
        'status', NEW.status
      ),
      timeout_milliseconds := 5000
    );

    -- Log the response (optional - for debugging)
    IF v_response.status >= 200 AND v_response.status < 300 THEN
      RAISE NOTICE 'Email notification sent successfully for inspection %', NEW.id;
    ELSE
      RAISE WARNING 'Failed to send email notification for inspection %. Status: %, Response: %',
        NEW.id, v_response.status, v_response.content;
    END IF;

  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the transaction
    RAISE WARNING 'Error sending email notification for inspection %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on inspections table
DROP TRIGGER IF EXISTS trigger_inspection_status_email ON inspections;

CREATE TRIGGER trigger_inspection_status_email
  AFTER UPDATE ON inspections
  FOR EACH ROW
  EXECUTE FUNCTION notify_inspection_status_change();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION notify_inspection_status_change() TO service_role;

-- Comment the trigger for documentation
COMMENT ON TRIGGER trigger_inspection_status_email ON inspections IS
  'Sends email notification via run-inspection/email/send endpoint when inspection status changes to done or failed';

COMMENT ON FUNCTION notify_inspection_status_change() IS
  'Trigger function that calls the email API endpoint when inspection status changes to done or failed. Uses vault credentials for authentication.';
