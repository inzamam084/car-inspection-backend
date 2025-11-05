-- Migration: Add simple versioning to inspections
-- Description: Auto-increment version when user creates inspection with same VIN
-- Recalculates version when VIN is updated to maintain proper versioning per VIN

-- ============================================================================
-- 1. Add version column to inspections table
-- ============================================================================
ALTER TABLE public.inspections 
ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ============================================================================
-- 2. Fix existing duplicate data before creating unique constraint
-- ============================================================================
-- This updates existing inspections to have proper sequential versions
-- For each user+vin combination, assigns versions 1, 2, 3, etc. based on creation date

DO $$
DECLARE
    user_vin_record RECORD;
    inspection_record RECORD;
    version_counter INTEGER;
BEGIN
    -- Loop through each user+vin combination that has duplicates
    FOR user_vin_record IN (
        SELECT user_id, vin
        FROM public.inspections
        WHERE vin IS NOT NULL
        GROUP BY user_id, vin
        HAVING COUNT(*) > 1
        ORDER BY user_id, vin
    )
    LOOP
        version_counter := 1;
        
        -- Update each inspection for this user+vin with sequential version
        FOR inspection_record IN (
            SELECT id
            FROM public.inspections
            WHERE user_id = user_vin_record.user_id
            AND vin = user_vin_record.vin
            ORDER BY created_at ASC, id ASC  -- Oldest first
        )
        LOOP
            UPDATE public.inspections
            SET version = version_counter
            WHERE id = inspection_record.id;
            
            version_counter := version_counter + 1;
        END LOOP;
        
        RAISE NOTICE 'Fixed versions for user % and VIN % (assigned % versions)', 
            user_vin_record.user_id, user_vin_record.vin, version_counter - 1;
    END LOOP;
END $$;

-- ============================================================================
-- 3. Create unique constraint for user_id + vin + version
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspections_user_vin_version 
ON public.inspections(user_id, vin, version) 
WHERE vin IS NOT NULL;

-- ============================================================================
-- 4. Create trigger to auto-increment version on INSERT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auto_increment_inspection_version()
RETURNS TRIGGER AS $$
DECLARE
    v_max_version INTEGER;
BEGIN
    -- Only process if VIN is provided
    IF NEW.vin IS NULL THEN
        NEW.version := 1;
        RETURN NEW;
    END IF;
    
    -- Get the highest version for this user+vin combination
    SELECT COALESCE(MAX(version), 0)
    INTO v_max_version
    FROM public.inspections
    WHERE user_id = NEW.user_id 
    AND vin = NEW.vin;
    
    -- Set next version
    NEW.version := v_max_version + 1;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create INSERT trigger
DROP TRIGGER IF EXISTS trigger_auto_increment_inspection_version ON public.inspections;
CREATE TRIGGER trigger_auto_increment_inspection_version
    BEFORE INSERT ON public.inspections
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_increment_inspection_version();

-- ============================================================================
-- 5. Create trigger to handle VIN updates
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_inspection_vin_update()
RETURNS TRIGGER AS $$
DECLARE
    v_max_version INTEGER;
BEGIN
    -- If VIN hasn't changed, no action needed
    IF OLD.vin IS NOT DISTINCT FROM NEW.vin THEN
        RETURN NEW;
    END IF;
    
    -- Case 1: VIN changed from NULL to a value
    IF OLD.vin IS NULL AND NEW.vin IS NOT NULL THEN
        -- Get the highest version for this user+new_vin combination
        SELECT COALESCE(MAX(version), 0)
        INTO v_max_version
        FROM public.inspections
        WHERE user_id = NEW.user_id 
        AND vin = NEW.vin
        AND id != NEW.id; -- Exclude current record
        
        -- Set next version for the new VIN
        NEW.version := v_max_version + 1;
        
        RAISE NOTICE 'VIN updated from NULL to %. Assigned version %', NEW.vin, NEW.version;
        RETURN NEW;
    END IF;
    
    -- Case 2: VIN changed from one value to another value
    IF OLD.vin IS NOT NULL AND NEW.vin IS NOT NULL THEN
        -- Always recalculate version for the new VIN
        SELECT COALESCE(MAX(version), 0)
        INTO v_max_version
        FROM public.inspections
        WHERE user_id = NEW.user_id 
        AND vin = NEW.vin
        AND id != NEW.id; -- Exclude current record
        
        -- Assign next available version for the new VIN
        NEW.version := v_max_version + 1;
        
        RAISE NOTICE 'VIN changed from % to %. Assigned version % (max existing version was %)', 
            OLD.vin, NEW.vin, NEW.version, v_max_version;
        
        RETURN NEW;
    END IF;
    
    -- Case 3: VIN changed from value to NULL
    IF OLD.vin IS NOT NULL AND NEW.vin IS NULL THEN
        NEW.version := 1;
        RAISE NOTICE 'VIN changed from % to NULL. Reset version to 1', OLD.vin;
        RETURN NEW;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create UPDATE trigger
DROP TRIGGER IF EXISTS trigger_handle_inspection_vin_update ON public.inspections;
CREATE TRIGGER trigger_handle_inspection_vin_update
    BEFORE UPDATE ON public.inspections
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_inspection_vin_update();

-- ============================================================================
-- 6. Add index for querying by version
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_inspections_user_vin_version_desc 
ON public.inspections(user_id, vin, version DESC) 
WHERE vin IS NOT NULL;

-- ============================================================================
-- 7. Add helpful comments
-- ============================================================================
COMMENT ON COLUMN public.inspections.version IS 
'Auto-incremented version number for each inspection. Increments automatically when user creates new inspection with same VIN, or when VIN is updated. Each VIN maintains its own version sequence.';

COMMENT ON FUNCTION public.auto_increment_inspection_version() IS
'Automatically assigns version number on INSERT based on user_id + vin combination. First inspection = version 1, second = version 2, etc.';

COMMENT ON FUNCTION public.handle_inspection_vin_update() IS
'Handles version management when VIN is updated:
- VIN added (NULL → value): Assigns next version for that VIN (e.g., if ABC123 has v1, v2, assigns v3)
- VIN changed (value → different value): Recalculates version for new VIN (e.g., if XYZ789 has no versions, assigns v1; if has v1, v2, assigns v3)
- VIN removed (value → NULL): Resets to version 1
This ensures each VIN maintains its own independent version sequence.';