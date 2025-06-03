-- Add cost and token tracking fields to processing_jobs table
ALTER TABLE processing_jobs 
ADD COLUMN cost DECIMAL(10,6) DEFAULT 0,
ADD COLUMN total_tokens INTEGER DEFAULT 0,
ADD COLUMN web_search_count INTEGER DEFAULT 0,
ADD COLUMN web_search_results JSONB;

-- Add comment for clarity
COMMENT ON COLUMN processing_jobs.cost IS 'Cost for this chunk processing in USD';
COMMENT ON COLUMN processing_jobs.total_tokens IS 'Total tokens used for this chunk';
COMMENT ON COLUMN processing_jobs.web_search_count IS 'Number of web searches performed in this chunk';
COMMENT ON COLUMN processing_jobs.web_search_results IS 'Web search results from this chunk';
