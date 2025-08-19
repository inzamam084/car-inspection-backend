-- Add missing columns to ai_activity_logs table
ALTER TABLE ai_activity_logs 
ADD COLUMN workflow_run_id TEXT,
ADD COLUMN status TEXT,
ADD COLUMN inspection_id UUID;

-- Create indexes for the new columns to improve query performance
CREATE INDEX idx_ai_activity_logs_workflow_run_id ON ai_activity_logs(workflow_run_id);
CREATE INDEX idx_ai_activity_logs_status ON ai_activity_logs(status);
CREATE INDEX idx_ai_activity_logs_inspection_id ON ai_activity_logs(inspection_id);

-- Add foreign key constraints for referential integrity
-- Uncomment the lines below if you want to enforce referential integrity

-- Foreign key for inspection_id (assuming it references inspections table)
-- ALTER TABLE ai_activity_logs ADD CONSTRAINT fk_ai_activity_logs_inspection_id FOREIGN KEY (inspection_id) REFERENCES inspections(id);

-- Foreign key for user_id (assuming it references auth.users table)
-- ALTER TABLE ai_activity_logs ADD CONSTRAINT fk_ai_activity_logs_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id);

-- Add comments to document the new columns
COMMENT ON COLUMN ai_activity_logs.workflow_run_id IS 'Dify workflow execution instance identifier for tracking workflow runs';
COMMENT ON COLUMN ai_activity_logs.status IS 'Status of the workflow or operation (e.g., completed, failed, running)';
COMMENT ON COLUMN ai_activity_logs.inspection_id IS 'Reference to the inspection record this AI activity is related to';
