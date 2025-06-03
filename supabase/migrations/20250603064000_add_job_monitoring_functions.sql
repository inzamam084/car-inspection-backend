-- Create function to check cron job status
CREATE OR REPLACE FUNCTION check_job_recovery_status()
RETURNS TABLE(
  job_name TEXT,
  schedule TEXT,
  active BOOLEAN,
  last_run TIMESTAMP WITH TIME ZONE,
  next_run TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    jobname::TEXT,
    schedule::TEXT,
    active,
    last_run,
    next_run
  FROM cron.job
  WHERE jobname = 'job-recovery';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check for currently stuck jobs
CREATE OR REPLACE FUNCTION check_stuck_jobs()
RETURNS TABLE(
  job_id UUID,
  inspection_id UUID,
  sequence_order INTEGER,
  status TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  retry_count INTEGER,
  minutes_stuck INTEGER,
  will_be_recovered BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pj.id,
    pj.inspection_id,
    pj.sequence_order,
    pj.status,
    pj.started_at,
    pj.retry_count,
    EXTRACT(EPOCH FROM (NOW() - pj.started_at))::INTEGER / 60 AS minutes_stuck,
    (
      (pj.status IN ('processing', 'failed')) 
      AND (pj.started_at < NOW() - INTERVAL '2 minutes')
      AND (pj.retry_count < 3)
      AND (pj.job_type = 'chunk_analysis')
    ) AS will_be_recovered
  FROM processing_jobs pj
  WHERE pj.status IN ('processing', 'failed')
    AND pj.started_at IS NOT NULL
  ORDER BY pj.inspection_id, pj.sequence_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get recovery logs
CREATE OR REPLACE FUNCTION get_recovery_logs(limit_count INTEGER DEFAULT 50)
RETURNS TABLE(
  log_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE,
  record_id UUID,
  message TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    fl.id,
    fl.created_at,
    fl.record_id,
    fl.error_message
  FROM function_logs fl
  WHERE fl.function_name = 'recover_stuck_jobs'
  ORDER BY fl.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to manually trigger job recovery (for testing)
CREATE OR REPLACE FUNCTION manual_job_recovery()
RETURNS TEXT AS $$
BEGIN
  PERFORM recover_stuck_jobs();
  RETURN 'Job recovery function executed manually. Check logs for results.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION check_job_recovery_status() TO postgres;
GRANT EXECUTE ON FUNCTION check_job_recovery_status() TO service_role;
GRANT EXECUTE ON FUNCTION check_stuck_jobs() TO postgres;
GRANT EXECUTE ON FUNCTION check_stuck_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION get_recovery_logs(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION get_recovery_logs(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION manual_job_recovery() TO postgres;
GRANT EXECUTE ON FUNCTION manual_job_recovery() TO service_role;

-- Add comments for documentation
COMMENT ON FUNCTION check_job_recovery_status() IS 'Check the status of the job recovery cron job';
COMMENT ON FUNCTION check_stuck_jobs() IS 'List currently stuck jobs and whether they will be recovered';
COMMENT ON FUNCTION get_recovery_logs(INTEGER) IS 'Get recent recovery logs from function_logs table';
COMMENT ON FUNCTION manual_job_recovery() IS 'Manually trigger job recovery for testing purposes';
