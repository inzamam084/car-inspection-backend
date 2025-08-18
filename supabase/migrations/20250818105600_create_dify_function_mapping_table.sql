-- Create dify_function_mapping table
CREATE TABLE dify_function_mapping (
    id BIGSERIAL PRIMARY KEY,
    app_name TEXT,
    api_key TEXT,
    type TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    app_id TEXT,
    function_name TEXT
);

-- Create indexes for better query performance
CREATE INDEX idx_dify_function_mapping_app_name ON dify_function_mapping(app_name);
CREATE INDEX idx_dify_function_mapping_app_id ON dify_function_mapping(app_id);
CREATE INDEX idx_dify_function_mapping_function_name ON dify_function_mapping(function_name);
CREATE INDEX idx_dify_function_mapping_type ON dify_function_mapping(type);
CREATE INDEX idx_dify_function_mapping_active ON dify_function_mapping(active);
CREATE INDEX idx_dify_function_mapping_created_at ON dify_function_mapping(created_at);

-- Create trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_dify_function_mapping_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_dify_function_mapping_updated_at
    BEFORE UPDATE ON dify_function_mapping
    FOR EACH ROW
    EXECUTE FUNCTION update_dify_function_mapping_updated_at();
