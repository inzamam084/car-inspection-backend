-- Create ai_activity_logs table
CREATE TABLE ai_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    task_id TEXT,
    message_id TEXT,
    event TEXT,
    mode TEXT,
    function_name TEXT,
    request_data JSONB,
    response_data JSONB,
    answer TEXT,
    prompt_tokens INTEGER,
    prompt_unit_price TEXT,
    prompt_price_unit TEXT,
    prompt_price TEXT,
    completion_tokens INTEGER,
    completion_unit_price TEXT,
    completion_price_unit TEXT,
    completion_price TEXT,
    total_tokens INTEGER,
    total_price TEXT,
    currency TEXT,
    latency NUMERIC,
    error TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    execution_time NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_ai_activity_logs_user_id ON ai_activity_logs(user_id);
CREATE INDEX idx_ai_activity_logs_task_id ON ai_activity_logs(task_id);
CREATE INDEX idx_ai_activity_logs_event ON ai_activity_logs(event);
CREATE INDEX idx_ai_activity_logs_function_name ON ai_activity_logs(function_name);
CREATE INDEX idx_ai_activity_logs_started_at ON ai_activity_logs(started_at);
CREATE INDEX idx_ai_activity_logs_created_at ON ai_activity_logs(created_at);

-- Create trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ai_activity_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ai_activity_logs_updated_at
    BEFORE UPDATE ON ai_activity_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_activity_logs_updated_at();
