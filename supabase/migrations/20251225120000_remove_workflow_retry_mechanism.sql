-- ============================================================================
-- Remove Unnecessary Workflow Retry Fields from Inspections Table
-- ============================================================================
-- The workflow retry mechanism at inspection level is redundant because:
-- 1. Each agent already has its own retry tracking in agent_executions
-- 2. Dify workflow handles the orchestration and will re-run failed agents
-- 3. The edge function now detects stuck agents and creates new execution records
-- 4. Workflow-level retries would duplicate the entire workflow unnecessarily

-- Drop workflow retry columns
ALTER TABLE public.inspections 
DROP COLUMN IF EXISTS workflow_retry_count,
DROP COLUMN IF EXISTS workflow_max_retries,
DROP COLUMN IF EXISTS workflow_last_retry_at,
DROP COLUMN IF EXISTS workflow_retry_reason;

-- Drop related index
DROP INDEX IF EXISTS idx_inspections_workflow_retry;

-- ============================================================================
-- Add Index for Stuck Agent Detection
-- ============================================================================
-- Index to help find agents that are stuck in 'running' state
CREATE INDEX IF NOT EXISTS idx_agent_executions_stuck_detection 
ON public.agent_executions(inspection_id, status, started_at) 
WHERE status = 'running';

-- ============================================================================
-- Add Index for Failed Agent Detection
-- ============================================================================
-- Index to help find failed/timeout agents that need retry
CREATE INDEX IF NOT EXISTS idx_agent_executions_failed_detection 
ON public.agent_executions(inspection_id, status, attempt_number, max_retries) 
WHERE status IN ('failed', 'timeout');

-- ============================================================================
-- Helpful Comments
-- ============================================================================
COMMENT ON INDEX idx_agent_executions_stuck_detection IS 
'Helps detect agents stuck in running state for timeout detection';

COMMENT ON INDEX idx_agent_executions_failed_detection IS 
'Helps detect failed/timeout agents that can be retried';

-- ============================================================================
-- Update Documentation Comments
-- ============================================================================
COMMENT ON TABLE public.agent_executions IS 
'Tracks individual agent executions within Dify workflows. Each agent attempt is recorded separately. The retry-workflow edge function detects stuck agents (running too long) and failed agents, then creates new execution records for retry. Dify workflow handles the orchestration.';

COMMENT ON COLUMN public.agent_executions.status IS 
'Current status: 
- pending: Agent execution created, waiting to start
- running: Agent is currently executing (if stuck too long, will be marked as timeout)
- completed: Agent finished successfully
- failed: Agent encountered an error
- timeout: Agent stuck in running state or exceeded time limit
- skipped: Agent was skipped by workflow logic
- cancelled: Agent was manually stopped';

COMMENT ON COLUMN public.agent_executions.attempt_number IS 
'Retry attempt number (1 = first try, 2 = first retry, etc.). The retry-workflow edge function creates new records with incremented attempt_number when detecting failures or timeouts.';
