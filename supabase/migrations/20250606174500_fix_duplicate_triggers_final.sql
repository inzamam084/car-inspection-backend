-- Drop any existing triggers and recreate with proper deduplication
-- Must drop trigger first, then function (due to dependencies)
DROP TRIGGER IF EXISTS processing_jobs_trigger ON processing_jobs;
DROP FUNCTION IF EXISTS trigger_next_job() CASCADE;

-- Create the final trigger function with comprehensive deduplication
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
              url := 'https://hhymqgsreoqpoqdpefhe.supabase.co/functions/v1/generate-final-report',
              headers := jsonb_build_object(
                  'Content-Type', 'application/json',
                  'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoeW1xZ3NyZW9xcG9xZHBlZmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY2ODU1MTIsImV4cCI6MjA2MjI2MTUxMn0.pcS49IJ2bLuyH_J1rkrf-0vRoCCycN0BhOdnnzlUOUw'
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
            url := 'https://hhymqgsreoqpoqdpefhe.supabase.co/functions/v1/process-next-chunk',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoeW1xZ3NyZW9xcG9xZHBlZmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY2ODU1MTIsImV4cCI6MjA2MjI2MTUxMn0.pcS49IJ2bLuyH_J1rkrf-0vRoCCycN0BhOdnnzlUOUw'
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

-- Create the trigger (ensure only one exists)
CREATE TRIGGER processing_jobs_trigger
  AFTER UPDATE ON processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_next_job();
