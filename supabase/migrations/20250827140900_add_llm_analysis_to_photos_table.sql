-- Add the `llm_analysis` column to the `photos` table to store JSON data from LLM image analysis
ALTER TABLE photos
ADD COLUMN llm_analysis JSONB NULL;

-- Add a comment to document the purpose of this column
COMMENT ON COLUMN photos.llm_analysis IS 'JSON data containing LLM analysis results for the photo';

-- Optionally, create an index on the llm_analysis column for better query performance
-- This is useful if you plan to query specific fields within the JSON
CREATE INDEX idx_photos_llm_analysis ON photos USING GIN (llm_analysis);

-- You can also create a partial index if you only want to index non-null values
-- CREATE INDEX idx_photos_llm_analysis_not_null ON photos USING GIN (llm_analysis) WHERE llm_analysis IS NOT NULL;
