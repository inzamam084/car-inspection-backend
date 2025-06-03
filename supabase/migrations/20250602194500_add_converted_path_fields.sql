-- Add converted_path field to photos table
ALTER TABLE photos ADD COLUMN IF NOT EXISTS converted_path TEXT;

-- Add converted_path field to obd2_codes table  
ALTER TABLE obd2_codes ADD COLUMN IF NOT EXISTS converted_path TEXT;

-- Add converted_path field to title_images table
ALTER TABLE title_images ADD COLUMN IF NOT EXISTS converted_path TEXT;
