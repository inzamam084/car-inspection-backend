-- Add ownership_cost_forecast to the processing_jobs table check constraint
ALTER TABLE processing_jobs 
DROP CONSTRAINT processing_jobs_job_type_check;

ALTER TABLE processing_jobs 
ADD CONSTRAINT processing_jobs_job_type_check 
CHECK (job_type IN ('chunk_analysis', 'final_report', 'fair_market_value', 'expert_advice', 'ownership_cost_forecast'));
