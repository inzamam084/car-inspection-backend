-- Add current_step field to inspections table
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS current_step TEXT;

-- Add step_data field to inspections table
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS step_data TEXT;

-- Add updated_at field to inspections table
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
