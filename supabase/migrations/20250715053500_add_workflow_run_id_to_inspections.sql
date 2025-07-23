-- Add workflow_run_id column to inspections table
-- This column can be null and will store workflow run identifiers

ALTER TABLE public.inspections 
ADD COLUMN workflow_run_id TEXT;

-- Add comment to document the column purpose
COMMENT ON COLUMN public.inspections.workflow_run_id IS 'Optional workflow run identifier for tracking specific workflow executions';

-- Create index for better query performance on workflow_run_id
CREATE INDEX IF NOT EXISTS idx_inspections_workflow_run_id ON public.inspections USING btree (workflow_run_id);
