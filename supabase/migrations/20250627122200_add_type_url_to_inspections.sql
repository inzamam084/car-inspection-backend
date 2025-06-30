-- Add type field to inspections table
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS type TEXT;

-- Add url field to inspections table
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS url TEXT;
