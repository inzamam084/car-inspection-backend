-- Convert workflow_id column from UUID to TEXT type
-- This migration handles the data type conversion safely

-- First, alter the column type from UUID to TEXT
ALTER TABLE public.inspections 
ALTER COLUMN workflow_id TYPE TEXT USING workflow_id::TEXT;

-- Update the comment to reflect the text type
COMMENT ON COLUMN public.inspections.workflow_id IS 'Optional workflow identifier for tracking inspection workflows (text format)';
