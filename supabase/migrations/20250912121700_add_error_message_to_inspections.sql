-- Add error_message column to inspections table
-- This column will store error messages for failed inspection processes or validation errors

ALTER TABLE public.inspections 
ADD COLUMN error_message TEXT;

-- Add comment to describe the column
COMMENT ON COLUMN public.inspections.error_message IS 'Error message for failed inspection processes or validation errors';
