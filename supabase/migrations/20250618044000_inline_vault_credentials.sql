-- Migration to drop helper functions and fetch credentials directly from Vault in trigger functions
-- This approach is cleaner and more direct than using separate helper functions

-- Drop the helper functions since we'll fetch credentials directly in trigger functions
DROP FUNCTION IF EXISTS get_supabase_url();
DROP FUNCTION IF EXISTS get_supabase_anon_key();

-- Update handle_new_report function to fetch credentials directly from Vault
CREATE OR REPLACE FUNCTION "public"."handle_new_report"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  supabase_url TEXT;
  supabase_anon_key TEXT;
BEGIN
  -- Add error handling for the HTTP request
  BEGIN
    -- Fetch credentials from Vault
    SELECT decrypted_secret INTO supabase_url
    FROM vault.decrypted_secrets
    WHERE name = 'SUPABASE_URL';
    
    SELECT decrypted_secret INTO supabase_anon_key
    FROM vault.decrypted_secrets
    WHERE name = 'SUPABASE_ANON_KEY';
    
    -- Call the edge function when a new report is created using dynamic URL and token
    PERFORM
      net.http_post(
        url := supabase_url || '/functions/v1/run-inspection',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || supabase_anon_key
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

-- Update trigger_next_job function to fetch credentials directly from Vault
CREATE OR REPLACE FUNCTION trigger_next_job()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  supabase_anon_key TEXT;
BEGIN
  -- Only trigger if job completed successfully
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    
    -- Add error handling for the HTTP request
    BEGIN
      -- Fetch credentials from Vault
      SELECT decrypted_secret INTO supabase_url
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_URL';
      
      SELECT decrypted_secret INTO supabase_anon_key
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_ANON_KEY';
      
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
              url := supabase_url || '/functions/v1/generate-final-report',
              headers := jsonb_build_object(
                  'Content-Type', 'application/json',
                  'Authorization', 'Bearer ' || supabase_anon_key
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
            url := supabase_url || '/functions/v1/process-next-chunk',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || supabase_anon_key
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

-- Update recover_stuck_jobs function to fetch credentials directly from Vault
CREATE OR REPLACE FUNCTION recover_stuck_jobs()
RETURNS void AS $$
DECLARE
  stuck_job RECORD;
  previous_completed_sequence INTEGER;
  supabase_url TEXT;
  supabase_anon_key TEXT;
BEGIN
  -- Fetch credentials from Vault once at the beginning
  SELECT decrypted_secret INTO supabase_url
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_URL';
  
  SELECT decrypted_secret INTO supabase_anon_key
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_ANON_KEY';
  
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
          url := supabase_url || '/functions/v1/process-next-chunk',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || supabase_anon_key
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

-- Add comments for documentation
COMMENT ON FUNCTION handle_new_report() IS 'Updated to fetch Supabase URL and anon key directly from Vault for environment-specific configuration';
COMMENT ON FUNCTION trigger_next_job() IS 'Updated to fetch Supabase URL and anon key directly from Vault for environment-specific configuration';
COMMENT ON FUNCTION recover_stuck_jobs() IS 'Updated to fetch Supabase URL and anon key directly from Vault for environment-specific configuration';
