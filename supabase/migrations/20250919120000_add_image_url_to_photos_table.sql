-- Add image_url column to photos table for storing original extension URLs
-- This stores the original URL from the browser extension before the image was downloaded and uploaded to Supabase storage

ALTER TABLE photos ADD COLUMN image_url TEXT;

-- Add comment to document the purpose of this column
COMMENT ON COLUMN photos.image_url IS 'Original image URL from browser extension before download and upload to Supabase storage';

-- Create index for better query performance when searching by image_url
CREATE INDEX idx_photos_image_url ON photos(image_url);

-- -- Add constraint to ensure image_url is a valid URL format (optional)
-- ALTER TABLE photos ADD CONSTRAINT chk_photos_image_url_format 
-- CHECK (image_url IS NULL OR image_url ~* '^https?://.*');

-- Update the trigger function to include image_url in any existing audit/logging if needed
-- (This is optional and depends on if you have existing audit triggers)

-- Example of how this column will be used:
-- When extension sends image data, we'll store:
-- 1. image_url: Original URL from the extension (e.g., 'https://cars.com/listing/123/image1.jpg')
-- 2. path: Our Supabase storage path after download/upload (e.g., 'inspections/uuid/exterior/image1.jpg')

-- This allows us to:
-- - Track the original source of images
-- - Handle re-processing if needed
-- - Maintain audit trail of image origins
-- - Debug issues with specific image sources
