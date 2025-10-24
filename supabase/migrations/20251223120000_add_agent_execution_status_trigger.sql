-- ============================================================================
-- Agent Execution Status Trigger
-- ============================================================================
-- This migration creates a trigger that automatically updates:
-- 1. started_at when status changes to 'running'
-- 2. completed_at when status changes to 'completed'
-- ============================================================================

-- ============================================================================
-- Create the trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION update_agent_execution_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    -- When status changes to 'running', set started_at if not already set
    IF NEW.status = 'running' AND (OLD.status IS NULL OR OLD.status != 'running') THEN
        IF NEW.started_at IS NULL THEN
            NEW.started_at := NOW();
        END IF;
    END IF;
    
    -- When status changes to 'completed', set completed_at and calculate duration
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        IF NEW.completed_at IS NULL THEN
            NEW.completed_at := NOW();
        END IF;
        
        -- Calculate duration in milliseconds if started_at is set
        IF NEW.started_at IS NOT NULL THEN
            NEW.duration_ms := EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000;
        END IF;
    END IF;
    
    -- When status changes to 'failed', 'timeout', or 'cancelled', also set completed_at
    IF NEW.status IN ('failed', 'timeout', 'cancelled') 
       AND (OLD.status IS NULL OR OLD.status NOT IN ('failed', 'timeout', 'cancelled', 'completed')) THEN
        IF NEW.completed_at IS NULL THEN
            NEW.completed_at := NOW();
        END IF;
        
        -- Calculate duration in milliseconds if started_at is set
        IF NEW.started_at IS NOT NULL THEN
            NEW.duration_ms := EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Create the trigger
-- ============================================================================
CREATE TRIGGER trigger_update_agent_execution_timestamps
    BEFORE UPDATE ON public.agent_executions
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_execution_timestamps();

-- ============================================================================
-- Helpful Comments
-- ============================================================================
COMMENT ON FUNCTION update_agent_execution_timestamps() IS 
'Automatically updates started_at when status changes to running, and completed_at + duration_ms when status changes to completed, failed, timeout, or cancelled';

COMMENT ON TRIGGER trigger_update_agent_execution_timestamps ON public.agent_executions IS 
'Triggers before update to automatically set started_at and completed_at timestamps based on status changes';
