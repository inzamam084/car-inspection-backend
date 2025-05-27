-- Add web search tracking fields to reports table
ALTER TABLE reports 
ADD COLUMN web_search_count INTEGER,
ADD COLUMN web_search_results JSONB;

-- Add comments for documentation
COMMENT ON COLUMN reports.web_search_count IS 'Number of web searches performed during analysis';
COMMENT ON COLUMN reports.web_search_results IS 'JSON array containing web search results and metadata';
