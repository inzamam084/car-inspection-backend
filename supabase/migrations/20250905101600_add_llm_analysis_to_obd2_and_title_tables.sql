-- Add the `llm_analysis` column to the `obd2_codes` table to store JSON data from LLM analysis
ALTER TABLE obd2_codes
ADD COLUMN llm_analysis JSONB NULL;

-- Add the `llm_analysis` column to the `title_images` table to store JSON data from LLM analysis
ALTER TABLE title_images
ADD COLUMN llm_analysis JSONB NULL;

-- Add comments to document the purpose of these columns
COMMENT ON COLUMN obd2_codes.llm_analysis IS 'JSON data containing LLM analysis results for the OBD2 code and its screenshot';
COMMENT ON COLUMN title_images.llm_analysis IS 'JSON data containing LLM analysis results for the title/ownership document image';

-- Create indexes on the llm_analysis columns for better query performance
-- These are useful for querying specific fields within the JSON data
CREATE INDEX idx_obd2_codes_llm_analysis ON obd2_codes USING GIN (llm_analysis);
CREATE INDEX idx_title_images_llm_analysis ON title_images USING GIN (llm_analysis);

-- Optional: Create partial indexes for non-null values only (uncomment if needed)
-- CREATE INDEX idx_obd2_codes_llm_analysis_not_null ON obd2_codes USING GIN (llm_analysis) WHERE llm_analysis IS NOT NULL;
-- CREATE INDEX idx_title_images_llm_analysis_not_null ON title_images USING GIN (llm_analysis) WHERE llm_analysis IS NOT NULL;
