-- Add the `extracted_content` column to the `inspections` table to store extracted page content from Chrome extension
-- This stores the raw text content extracted from listing pages (Cars & Bids, Copart, etc.)

ALTER TABLE inspections
ADD COLUMN extracted_content TEXT NULL;

-- Add comment to document the purpose of this column
COMMENT ON COLUMN inspections.extracted_content IS 'Text content extracted from vehicle listing pages via Chrome extension. Contains full page text for search and analysis purposes.';

