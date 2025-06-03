-- Update the trigger function with proper error handling
CREATE OR REPLACE FUNCTION trigger_next_job()
RETURNS TRIGGER AS $$

BEGIN
  -- Only trigger if job completed successfully
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    
    -- Add error handling for the HTTP request
    BEGIN
      -- Check if this is the last chunk
      IF NEW.job_type = 'chunk_analysis' AND NEW.chunk_index = NEW.total_chunks THEN
        -- Trigger final report generation
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
      ELSE
        -- Trigger next chunk processing
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
