-- Add the `vehicle_details` column to the `inspections` table to store JSON data about vehicle information
ALTER TABLE inspections
ADD COLUMN vehicle_details JSONB NULL;

-- Add comment to document the purpose of this column
COMMENT ON COLUMN inspections.vehicle_details IS 'JSON data containing detailed vehicle information such as make, model, year, engine specs, features, and other vehicle characteristics';

-- Create index on the vehicle_details column for better query performance
-- This is useful for querying specific fields within the JSON data
CREATE INDEX idx_inspections_vehicle_details ON inspections USING GIN (vehicle_details);

-- Optional: Create partial index for non-null values only (uncomment if needed)
-- CREATE INDEX idx_inspections_vehicle_details_not_null ON inspections USING GIN (vehicle_details) WHERE vehicle_details IS NOT NULL;
