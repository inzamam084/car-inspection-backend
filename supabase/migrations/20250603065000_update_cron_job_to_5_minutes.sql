-- Update the existing cron job to run every 5 minutes instead of 2 minutes
SELECT cron.unschedule('job-recovery');

-- Update the recover_stuck_jobs function to check for jobs stuck for more than 5 minutes
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
      -- Call process-next-chunk edge function to restart the job
      PERFORM
        net.http_post(
          url := 'https://hhymqgsreoqpoqdpefhe.supabase.co/functions/v1/process-next-chunk',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoeW1xZ3NyZW9xcG9xZHBlZmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY2ODU1MTIsImV4cCI6MjA2MjI2MTUxMn0.pcS49IJ2bLuyH_J1rkrf-0vRoCCycN0BhOdnnzlUOUw'
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

-- Schedule the recovery job to run every 5 minutes
SELECT cron.schedule(
  'job-recovery',
  '*/5 * * * *',  -- Every 5 minutes
  'SELECT recover_stuck_jobs();'
);

-- Add comment for documentation
COMMENT ON FUNCTION recover_stuck_jobs() IS 'Recovers stuck processing jobs by resetting them to pending and triggering process-next-chunk (updated to 5 minute intervals)';
