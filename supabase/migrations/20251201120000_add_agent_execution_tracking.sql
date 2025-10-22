-- ============================================================================
-- Agent Executions Tracking Table
-- ============================================================================
CREATE TABLE public.agent_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Core references
    inspection_id UUID NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
    workflow_run_id TEXT NOT NULL,
    
    -- Agent identification
    agent_name TEXT NOT NULL,
    agent_type TEXT NOT NULL, -- 'cost_forecast', 'expert_advice', 'market_value', 'reconditioning', 'condition_report', 'image_processing'
    
    -- Execution status
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_number INTEGER NOT NULL DEFAULT 1,
    max_retries INTEGER NOT NULL DEFAULT 3,
    
    -- Timing
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    
    -- Results and errors
    result_data JSONB,
    error_message TEXT,
    error_code TEXT,
    error_stack TEXT,
    
    -- Additional metadata
    input_data JSONB,
    metadata JSONB,
    dify_app_name TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- ========================================
    -- Constraints
    -- ========================================
    CONSTRAINT agent_executions_status_check CHECK (
        status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'timeout', 'cancelled')
    ),
    CONSTRAINT agent_executions_attempt_check CHECK (attempt_number > 0),
    CONSTRAINT agent_executions_max_retries_check CHECK (max_retries >= 0),
    
    -- Unique: one execution record per agent per attempt per workflow run
    CONSTRAINT agent_executions_unique_attempt UNIQUE (inspection_id, workflow_run_id, agent_name, attempt_number)
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================
CREATE INDEX idx_agent_executions_inspection_id ON public.agent_executions(inspection_id);
CREATE INDEX idx_agent_executions_workflow_run_id ON public.agent_executions(workflow_run_id);
CREATE INDEX idx_agent_executions_agent_name ON public.agent_executions(agent_name);
CREATE INDEX idx_agent_executions_agent_type ON public.agent_executions(agent_type);
CREATE INDEX idx_agent_executions_status ON public.agent_executions(status);
CREATE INDEX idx_agent_executions_created_at ON public.agent_executions(created_at DESC);
CREATE INDEX idx_agent_executions_started_at ON public.agent_executions(started_at DESC);

-- Composite indexes for common queries
CREATE INDEX idx_agent_executions_inspection_status ON public.agent_executions(inspection_id, status);
CREATE INDEX idx_agent_executions_workflow_status ON public.agent_executions(workflow_run_id, status);
CREATE INDEX idx_agent_executions_inspection_agent ON public.agent_executions(inspection_id, agent_name);
CREATE INDEX idx_agent_executions_workflow_agent_status ON public.agent_executions(workflow_run_id, agent_name, status);

-- Index for finding latest attempt per agent
CREATE INDEX idx_agent_executions_latest_attempt ON public.agent_executions(
    inspection_id, 
    workflow_run_id, 
    agent_name, 
    attempt_number DESC
);

-- Index for finding failed/timeout agents that can be retried
CREATE INDEX idx_agent_executions_retryable ON public.agent_executions(
    inspection_id, 
    status, 
    attempt_number
) WHERE status IN ('failed', 'timeout') AND attempt_number < max_retries;

-- ============================================================================
-- Trigger for auto-updating updated_at
-- ============================================================================
CREATE TRIGGER update_agent_executions_updated_at
    BEFORE UPDATE ON public.agent_executions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Add workflow retry fields to inspections table
-- ============================================================================
ALTER TABLE public.inspections 
ADD COLUMN IF NOT EXISTS workflow_retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS workflow_max_retries INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS workflow_last_retry_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS workflow_retry_reason TEXT;

-- Add index for finding inspections that need retry
CREATE INDEX IF NOT EXISTS idx_inspections_workflow_retry ON public.inspections(
    workflow_retry_count, 
    status
) WHERE workflow_run_id IS NOT NULL AND status IN ('processing', 'failed');

-- ============================================================================
-- Permissions
-- ============================================================================
GRANT SELECT ON TABLE public.agent_executions TO authenticated;
GRANT ALL ON TABLE public.agent_executions TO service_role;
GRANT ALL ON TABLE public.agent_executions TO postgres;

-- ============================================================================
-- Helpful Comments
-- ============================================================================
COMMENT ON TABLE public.agent_executions IS 
'Tracks individual agent executions within Dify workflows. Each agent attempt is recorded separately to enable smart retry logic that skips successful agents.';

COMMENT ON COLUMN public.agent_executions.inspection_id IS 
'Reference to the parent inspection';

COMMENT ON COLUMN public.agent_executions.workflow_run_id IS 
'Unique identifier for the workflow run (e.g., wf_1234567890_abc123)';

COMMENT ON COLUMN public.agent_executions.agent_name IS 
'Unique name of the agent (e.g., cost_forecast_agent, expert_advice_agent)';

COMMENT ON COLUMN public.agent_executions.agent_type IS 
'Type/category of agent for grouping and querying';

COMMENT ON COLUMN public.agent_executions.status IS 
'Current status: pending (not started), running (in progress), completed (success), failed (error), timeout (exceeded time limit), skipped (not needed), cancelled (manually stopped)';

COMMENT ON COLUMN public.agent_executions.attempt_number IS 
'Retry attempt number (1 = first try, 2 = first retry, etc.)';

COMMENT ON COLUMN public.agent_executions.max_retries IS 
'Maximum number of retry attempts allowed for this agent';

COMMENT ON COLUMN public.agent_executions.result_data IS 
'JSONB containing the successful result/output from the agent';

COMMENT ON COLUMN public.agent_executions.error_message IS 
'Human-readable error message if the agent failed';

COMMENT ON COLUMN public.agent_executions.error_code IS 
'Machine-readable error code for categorizing failures';

COMMENT ON COLUMN public.agent_executions.input_data IS 
'JSONB containing the input parameters sent to the agent';

COMMENT ON COLUMN public.agent_executions.metadata IS 
'Additional metadata (model used, temperature, etc.)';

COMMENT ON COLUMN public.agent_executions.dify_app_name IS 
'Name of the Dify app/workflow that was executed';

COMMENT ON COLUMN public.inspections.workflow_retry_count IS 
'Number of times the entire workflow has been retried';

COMMENT ON COLUMN public.inspections.workflow_max_retries IS 
'Maximum number of full workflow retries allowed';

COMMENT ON COLUMN public.inspections.workflow_last_retry_at IS 
'Timestamp of the last workflow retry attempt';

COMMENT ON COLUMN public.inspections.workflow_retry_reason IS 
'Reason for the last workflow retry (e.g., "3 agents failed: cost_forecast, expert_advice, market_value")';