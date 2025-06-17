-- Migration to make all hardcoded URLs and JWT tokens environment-specific
-- This replaces hardcoded values with dynamic ones that work across different Supabase environments

-- Create helper function to get current Supabase project URL
CREATE OR REPLACE FUNCTION get_supabase_url()
RETURNS TEXT AS $$
DECLARE
  project_ref TEXT;
  supabase_url TEXT;
BEGIN
  -- Try to get from custom setting first (allows manual override)
  BEGIN
    supabase_url := current_setting('app.supabase_url', true);
    IF supabase_url IS NOT NULL AND supabase_url != '' THEN
      RETURN supabase_url;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      -- Setting doesn't exist, continue with auto-detection
      NULL;
  END;
  
  -- Auto-detect from current database connection
  -- Extract project reference from current database URL or use a fallback method
  SELECT current_database() INTO project_ref;
  
  -- For Supabase, the URL pattern is https://{project_ref}.supabase.co
  -- We'll construct it from the project reference
  -- Note: This assumes standard Supabase hosting. For custom domains, use app.supabase_url setting
  
  -- Try to get project ref from pg_stat_ssl or other system info
  -- As a fallback, we'll use a setting that must be configured per environment
  BEGIN
    project_ref := current_setting('app.project_ref', false);
    supabase_url := 'https://' || project_ref || '.supabase.co';
    RETURN supabase_url;
  EXCEPTION
    WHEN OTHERS THEN
      -- If no project_ref setting, raise an error with instructions
      RAISE EXCEPTION 'Supabase project reference not configured. Please set app.project_ref using: ALTER DATABASE % SET app.project_ref = ''your-project-ref'';', current_database();
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create helper function to get environment-specific JWT token
CREATE OR REPLACE FUNCTION get_supabase_anon_key()
RETURNS TEXT AS $$
DECLARE
  anon_key TEXT;
BEGIN
  -- Get anon key from database setting
  BEGIN
    anon_key := current_setting('app.supabase_anon_key', false);
    RETURN anon_key;
  EXCEPTION
    WHEN OTHERS THEN
      -- If no anon key setting, raise an error with instructions
      RAISE EXCEPTION 'Supabase anon key not configured. Please set app.supabase_anon_key using: ALTER DATABASE % SET app.supabase_anon_key = ''your-anon-key'';', current_database();
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update handle_new_report function to use dynamic values
CREATE OR REPLACE FUNCTION "public"."handle_new_report"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$BEGIN
  -- Add error handling for the HTTP request
  BEGIN
    -- Call the edge function when a new report is created using dynamic URL and token
    PERFORM
      net.http_post(
        url := get_supabase_url() || '/functions/v1/run-inspection',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || get_supabase_anon_key()
        ),
        body := jsonb_build_object(
          'inspection_id', NEW.inspection_id
        )
      );
  EXCEPTION
    WHEN OTHERS THEN
      -- Log the error and continue (prevents failed edge function calls from blocking database operations)
      INSERT INTO public.function_logs (function_name, error_message, record_id)
      VALUES ('handle_new_report', SQLERRM, NEW.id);
  END;
  
  RETURN NEW;
END;$$;

-- Update trigger_next_job function to use dynamic values
CREATE OR REPLACE FUNCTION trigger_next_job()
RETURNS TRIGGER AS $$

BEGIN
  -- Only trigger if job completed successfully
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    
    -- Add error handling for the HTTP request
    BEGIN
      -- If this is the expert_advice job completing, trigger final report generation
      IF NEW.job_type = 'expert_advice' THEN
        -- Check if email has already been sent for this inspection
        DECLARE
          email_already_sent BOOLEAN := FALSE;
        BEGIN
          SELECT COALESCE(email_sent, FALSE) INTO email_already_sent
          FROM inspections 
          WHERE id = NEW.inspection_id;
          
          -- Only trigger final report if email hasn't been sent yet
          IF NOT email_already_sent THEN
            PERFORM
              net.http_post(
              url := get_supabase_url() || '/functions/v1/generate-final-report',
              headers := jsonb_build_object(
                  'Content-Type', 'application/json',
                  'Authorization', 'Bearer ' || get_supabase_anon_key()
              ),
              body := jsonb_build_object(
                  'inspection_id', NEW.inspection_id
              )
            );
          END IF;
        END;
      ELSE
        -- For all other job types (chunk_analysis, fair_market_value), trigger next job processing
        PERFORM
          net.http_post(
            url := get_supabase_url() || '/functions/v1/process-next-chunk',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || get_supabase_anon_key()
            ),
            body := jsonb_build_object(
              'inspection_id', NEW.inspection_id,
              'completed_sequence', NEW.sequence_order
            )
          );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        -- Log the error and continue (prevents failed edge function calls from blocking database operations)
        INSERT INTO public.function_logs (function_name, error_message, record_id)
        VALUES ('trigger_next_job', SQLERRM, NEW.id);
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update recover_stuck_jobs function to use dynamic values
CREATE OR REPLACE FUNCTION recover_stuck_jobs()
RETURNS void AS $$
DECLARE
  stuck_job RECORD;
  previous_completed_sequence INTEGER;
BEGIN
  -- Find stuck jobs that need recovery
  FOR stuck_job IN
    SELECT id, inspection_id, sequence_order, status, started_at, retry_count
    FROM processing_jobs
    WHERE (
      -- Processing jobs stuck for more than 5 minutes
      (status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes')
      OR
      -- Failed jobs stuck for more than 5 minutes
      (status = 'failed' AND started_at < NOW() - INTERVAL '5 minutes')
    )
    AND retry_count < 3  -- Max 3 retries
    AND job_type = 'chunk_analysis'  -- Only recover chunk analysis jobs
    ORDER BY inspection_id, sequence_order
  LOOP
    -- Find the previous completed sequence for this inspection
    SELECT COALESCE(MAX(sequence_order), 0) INTO previous_completed_sequence
    FROM processing_jobs
    WHERE inspection_id = stuck_job.inspection_id
      AND sequence_order < stuck_job.sequence_order
      AND status = 'completed';
    
    -- Log the recovery action
    INSERT INTO public.function_logs (function_name, error_message, record_id)
    VALUES (
      'recover_stuck_jobs',
      'Recovering stuck job: ' || stuck_job.status || ' job ' || stuck_job.id || 
      ' (sequence ' || stuck_job.sequence_order || ') for inspection ' || stuck_job.inspection_id ||
      ', retry count: ' || stuck_job.retry_count || ', previous completed: ' || previous_completed_sequence,
      stuck_job.id
    );
    
    -- Increment retry count and reset job to pending
    UPDATE processing_jobs
    SET 
      status = 'pending',
      retry_count = retry_count + 1,
      started_at = NULL,
      error_message = NULL
    WHERE id = stuck_job.id;
    
    -- Add error handling for the HTTP request
    BEGIN
      -- Call process-next-chunk edge function to restart the job using dynamic values
      PERFORM
        net.http_post(
          url := get_supabase_url() || '/functions/v1/process-next-chunk',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || get_supabase_anon_key()
          ),
          body := jsonb_build_object(
            'inspection_id', stuck_job.inspection_id,
            'completed_sequence', previous_completed_sequence
          )
        );
      
      -- Log successful recovery trigger
      INSERT INTO public.function_logs (function_name, error_message, record_id)
      VALUES (
        'recover_stuck_jobs',
        'Successfully triggered recovery for job ' || stuck_job.id || 
        ' with completed_sequence: ' || previous_completed_sequence,
        stuck_job.id
      );
      
    EXCEPTION
      WHEN OTHERS THEN
        -- Log the error but continue with other jobs
        INSERT INTO public.function_logs (function_name, error_message, record_id)
        VALUES (
          'recover_stuck_jobs',
          'Failed to trigger recovery for job ' || stuck_job.id || ': ' || SQLERRM,
          stuck_job.id
        );
    END;
    
  END LOOP;
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions for the new helper functions
GRANT EXECUTE ON FUNCTION get_supabase_url() TO postgres;
GRANT EXECUTE ON FUNCTION get_supabase_url() TO service_role;
GRANT EXECUTE ON FUNCTION get_supabase_url() TO authenticated;
GRANT EXECUTE ON FUNCTION get_supabase_url() TO anon;

GRANT EXECUTE ON FUNCTION get_supabase_anon_key() TO postgres;
GRANT EXECUTE ON FUNCTION get_supabase_anon_key() TO service_role;
GRANT EXECUTE ON FUNCTION get_supabase_anon_key() TO authenticated;
GRANT EXECUTE ON FUNCTION get_supabase_anon_key() TO anon;

-- Add comments for documentation
COMMENT ON FUNCTION get_supabase_url() IS 'Returns the current Supabase project URL dynamically based on environment configuration';
COMMENT ON FUNCTION get_supabase_anon_key() IS 'Returns the environment-specific Supabase anon key from database settings';
COMMENT ON FUNCTION handle_new_report() IS 'Updated to use dynamic Supabase URL and anon key for environment-specific configuration';
COMMENT ON FUNCTION trigger_next_job() IS 'Updated to use dynamic Supabase URL and anon key for environment-specific configuration';
COMMENT ON FUNCTION recover_stuck_jobs() IS 'Updated to use dynamic Supabase URL and anon key for environment-specific configuration';
