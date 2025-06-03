-- Create processing jobs table for queue-based chunk processing
CREATE TABLE processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES inspections(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('chunk_analysis', 'final_report')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  sequence_order INTEGER NOT NULL,
  chunk_index INTEGER, -- NULL for final_report job
  total_chunks INTEGER,
  chunk_data JSONB, -- Image IDs and metadata for this chunk
  chunk_result JSONB, -- Analysis result (becomes context for next chunk)
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for efficient querying
CREATE INDEX idx_processing_jobs_sequence ON processing_jobs(inspection_id, sequence_order);
CREATE INDEX idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX idx_processing_jobs_inspection ON processing_jobs(inspection_id);

-- Create function to trigger next job processing
CREATE OR REPLACE FUNCTION trigger_next_job()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Only trigger if job completed successfully
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Get environment variables (these should be set in your Supabase project)
    supabase_url := current_setting('app.supabase_url', true);
    service_role_key := current_setting('app.service_role_key', true);
    
    -- Use default values if not set
    IF supabase_url IS NULL THEN
      supabase_url := 'https://hhymqgsreoqpoqdpefhe.supabase.co';
    END IF;
    
    -- Check if this is the last chunk
    IF NEW.job_type = 'chunk_analysis' AND NEW.chunk_index = NEW.total_chunks THEN
      -- Trigger final report generation
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/generate-final-report',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
        ),
        body := jsonb_build_object(
          'inspection_id', NEW.inspection_id
        )::text
      );
    ELSE
      -- Trigger next chunk processing
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/process-next-chunk',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
        ),
        body := jsonb_build_object(
          'inspection_id', NEW.inspection_id,
          'completed_sequence', NEW.sequence_order
        )::text
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
CREATE TRIGGER after_job_completion
  AFTER UPDATE ON processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_next_job();

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON processing_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON processing_jobs TO service_role;
