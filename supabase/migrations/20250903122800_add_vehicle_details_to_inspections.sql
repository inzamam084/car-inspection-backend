-- Add vehicle_details column to inspections table
ALTER TABLE public.inspections 
ADD COLUMN vehicle_details jsonb;

-- Add comment to document the column purpose
COMMENT ON COLUMN public.inspections.vehicle_details IS 'Stores extracted vehicle data from image analysis including VIN, make, model, year, etc.';
