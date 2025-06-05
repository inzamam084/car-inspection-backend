-- Update the trigger function to prevent duplicate email sending
CREATE OR REPLACE FUNCTION trigger_next_job()
RETURNS TRIGGER AS $$

BEGIN
  -- Only trigger if job completed successfully
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    
    -- Add error handling for the HTTP request
    BEGIN
      -- Check if both fair_market_value and expert_advice jobs are completed
      DECLARE
        fair_market_value_completed BOOLEAN := FALSE;
        expert_advice_completed BOOLEAN := FALSE;
        email_already_sent BOOLEAN := FALSE;
      BEGIN
        -- Check if fair_market_value job is completed
        SELECT EXISTS(
          SELECT 1 FROM processing_jobs 
          WHERE inspection_id = NEW.inspection_id 
          AND job_type = 'fair_market_value' 
          AND status = 'completed'
        ) INTO fair_market_value_completed;
        
        -- Check if expert_advice job is completed
        SELECT EXISTS(
          SELECT 1 FROM processing_jobs 
          WHERE inspection_id = NEW.inspection_id 
          AND job_type = 'expert_advice' 
          AND status = 'completed'
        ) INTO expert_advice_completed;
        
        -- Check if email has already been sent for this inspection
        SELECT COALESCE(email_sent, FALSE) INTO email_already_sent
        FROM inspections 
        WHERE id = NEW.inspection_id;
        
        -- If both agent jobs are completed AND email hasn't been sent yet, trigger final report generation
        IF fair_market_value_completed AND expert_advice_completed AND NOT email_already_sent THEN
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
        ELSIF NOT fair_market_value_completed OR NOT expert_advice_completed THEN
          -- Trigger next job processing only if agents are not yet completed
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
        -- If email_already_sent is TRUE, do nothing (prevents duplicate emails)
        
      END;
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
