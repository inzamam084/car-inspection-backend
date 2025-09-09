-- Add foreign key constraints to ai_activity_logs table for referential integrity

-- Add foreign key constraint for user_id referencing auth.users
ALTER TABLE ai_activity_logs
ADD CONSTRAINT fk_ai_activity_logs_user_id
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add foreign key constraint for inspection_id referencing inspections table
ALTER TABLE ai_activity_logs
ADD CONSTRAINT fk_ai_activity_logs_inspection_id
FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE SET NULL;

-- Add comments to document the foreign key relationships
COMMENT ON CONSTRAINT fk_ai_activity_logs_user_id ON ai_activity_logs IS 'Foreign key constraint linking ai_activity_logs.user_id to auth.users.id';
COMMENT ON CONSTRAINT fk_ai_activity_logs_inspection_id ON ai_activity_logs IS 'Foreign key constraint linking ai_activity_logs.inspection_id to inspections.id';
