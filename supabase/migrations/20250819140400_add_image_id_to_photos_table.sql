-- Add the `image_id` column to the `photos` table
ALTER TABLE photos
ADD COLUMN image_id VARCHAR(255) NULL;

-- Optionally, you can create an index on the `image_id` if you expect to query it often
CREATE INDEX idx_photos_image_id ON photos(image_id);