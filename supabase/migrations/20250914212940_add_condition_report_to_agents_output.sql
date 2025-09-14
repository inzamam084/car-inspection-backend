-- Add condition_report column to agents_output table
ALTER TABLE "public"."agents_output" 
ADD COLUMN "condition_report" "jsonb";

-- Add comment to document the new column
COMMENT ON COLUMN "public"."agents_output"."condition_report" 
IS 'Stores output from the condition report agent as JSON data';
