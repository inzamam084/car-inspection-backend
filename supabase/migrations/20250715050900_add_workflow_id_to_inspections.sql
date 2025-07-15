-- Add workflow_id column to inspections table
-- This column can be null and will store workflow identifiers

ALTER TABLE public.inspections 
ADD COLUMN workflow_id uuid NULL;

-- Add comment to document the column purpose
COMMENT ON COLUMN public.inspections.workflow_id IS 'Optional workflow identifier for tracking inspection workflows';

-- Create index for better query performance on workflow_id
CREATE INDEX IF NOT EXISTS idx_inspections_workflow_id ON public.inspections USING btree (workflow_id);
