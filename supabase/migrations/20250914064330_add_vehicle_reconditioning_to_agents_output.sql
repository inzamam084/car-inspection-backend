-- Add vehicle_reconditioning column to agents_output table
ALTER TABLE "public"."agents_output" 
ADD COLUMN "vehicle_reconditioning" "jsonb";

-- Add comment to document the new column
COMMENT ON COLUMN "public"."agents_output"."vehicle_reconditioning" 
IS 'Stores output from the vehicle reconditioning agent as JSON data';
