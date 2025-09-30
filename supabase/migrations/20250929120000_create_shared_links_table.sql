-- Create shared_links table for admin-generated file upload links
-- This enables admins to generate secure, shareable links for users to upload inspection files
-- Each link can be used for MULTIPLE inspections based on max_uses

CREATE TABLE public.shared_links (
  id uuid not null default gen_random_uuid(),
  token text not null unique,
  
  -- Link ownership and metadata
  created_by uuid not null references public.profiles(id) on delete cascade,
  recipient_email text,
  
  -- Link expiration
  expires_at timestamp with time zone not null,
  
  -- Link usage tracking
  max_uses integer not null default 1 check (max_uses > 0),
  current_uses integer not null default 0 check (current_uses >= 0),
  
  -- Status tracking
  status text not null default 'active' check (status in ('active', 'expired', 'used', 'revoked', 'completed')),
  
  -- Optional metadata
  metadata jsonb, -- For storing additional custom data
  
  -- Tracking fields
  first_accessed_at timestamp with time zone,
  last_accessed_at timestamp with time zone,
  completed_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text,
  
  -- Timestamps
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  
  primary key (id),
  
  -- Constraint to ensure current_uses never exceeds max_uses
  constraint check_uses_limit check (current_uses <= max_uses)
);

-- Create junction table to link multiple inspections to one shared link
CREATE TABLE public.shared_link_inspections (
  id uuid not null default gen_random_uuid(),
  shared_link_id uuid not null references public.shared_links(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  
  primary key (id),
  
  -- Ensure one inspection can only be linked to one shared link
  unique(inspection_id)
);

-- Create indexes for better query performance on shared_links
CREATE INDEX idx_shared_links_token ON public.shared_links(token);
CREATE INDEX idx_shared_links_created_by ON public.shared_links(created_by);
CREATE INDEX idx_shared_links_status ON public.shared_links(status);
CREATE INDEX idx_shared_links_expires_at ON public.shared_links(expires_at);
CREATE INDEX idx_shared_links_recipient_email ON public.shared_links(recipient_email);
CREATE INDEX idx_shared_links_created_at ON public.shared_links(created_at DESC);

-- Create composite index for active links lookup
CREATE INDEX idx_shared_links_token_status_expires ON public.shared_links(token, status, expires_at) 
WHERE status = 'active';

-- Create indexes for shared_link_inspections junction table
CREATE INDEX idx_shared_link_inspections_shared_link_id ON public.shared_link_inspections(shared_link_id);
CREATE INDEX idx_shared_link_inspections_inspection_id ON public.shared_link_inspections(inspection_id);

-- Add comments for documentation
COMMENT ON TABLE public.shared_links IS 'Admin-generated links for secure file uploads - can be used for multiple inspections based on max_uses';
COMMENT ON COLUMN public.shared_links.token IS 'Unique token for the shared link (URL-safe, used in shareable link)';
COMMENT ON COLUMN public.shared_links.created_by IS 'Admin user who generated this link';
COMMENT ON COLUMN public.shared_links.recipient_email IS 'Email of the intended recipient (optional, for tracking)';
COMMENT ON COLUMN public.shared_links.expires_at IS 'Link expiration timestamp';
COMMENT ON COLUMN public.shared_links.max_uses IS 'Maximum number of inspections that can be created with this link (default: 1)';
COMMENT ON COLUMN public.shared_links.current_uses IS 'Current number of inspections created with this link';
COMMENT ON COLUMN public.shared_links.status IS 'Link status: active (usable), expired (past expiration), used (max uses reached), revoked (manually disabled), completed (all uploads finished)';
COMMENT ON COLUMN public.shared_links.metadata IS 'Additional custom metadata in JSON format';
COMMENT ON COLUMN public.shared_links.first_accessed_at IS 'First time the link was accessed';
COMMENT ON COLUMN public.shared_links.last_accessed_at IS 'Most recent access time';
COMMENT ON COLUMN public.shared_links.completed_at IS 'When all uploads were completed';
COMMENT ON COLUMN public.shared_links.revoked_at IS 'When the link was revoked';
COMMENT ON COLUMN public.shared_links.revoked_by IS 'Admin who revoked the link';

COMMENT ON TABLE public.shared_link_inspections IS 'Junction table linking shared links to multiple inspections';
COMMENT ON COLUMN public.shared_link_inspections.shared_link_id IS 'Reference to the shared link';
COMMENT ON COLUMN public.shared_link_inspections.inspection_id IS 'Reference to the inspection created via this link';

-- Enable Row Level Security
ALTER TABLE public.shared_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_link_inspections ENABLE ROW LEVEL SECURITY;

-- Grant permissions to different roles
GRANT ALL ON TABLE public.shared_links TO anon;
GRANT ALL ON TABLE public.shared_links TO authenticated;
GRANT ALL ON TABLE public.shared_links TO service_role;

GRANT ALL ON TABLE public.shared_link_inspections TO anon;
GRANT ALL ON TABLE public.shared_link_inspections TO authenticated;
GRANT ALL ON TABLE public.shared_link_inspections TO service_role;

-- ========================================
-- TRIGGER FUNCTIONS
-- ========================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_shared_links_updated_at()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger for updated_at
CREATE TRIGGER update_shared_links_updated_at_trigger
  BEFORE UPDATE ON public.shared_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_shared_links_updated_at();

-- Function to auto-update status based on conditions
CREATE OR REPLACE FUNCTION public.auto_update_shared_link_status()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$
BEGIN
  -- Auto-expire if past expiration date (only for active links)
  IF NEW.expires_at <= now() AND NEW.status = 'active' THEN
    NEW.status := 'expired';
  END IF;
  
  -- Auto-mark as used when max uses reached (only for active links)
  IF NEW.current_uses >= NEW.max_uses AND NEW.status = 'active' THEN
    NEW.status := 'used';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for auto-status updates
CREATE TRIGGER auto_update_shared_link_status_trigger
  BEFORE INSERT OR UPDATE ON public.shared_links
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_update_shared_link_status();

-- ========================================
-- HELPER FUNCTIONS
-- ========================================

-- Function to generate secure random token
CREATE OR REPLACE FUNCTION public.generate_shared_link_token(byte_length integer DEFAULT 24)
RETURNS text 
LANGUAGE plpgsql 
VOLATILE
AS $$
BEGIN
  -- Generate random bytes and encode as base64url (URL-safe)
  -- Translate characters to make it URL-safe and remove padding
  RETURN translate(
    encode(gen_random_bytes(byte_length), 'base64'),
    '+/=',
    '-_'
  );
END;
$$;

COMMENT ON FUNCTION public.generate_shared_link_token IS 'Generate a cryptographically secure random token for shared links using gen_random_bytes()';

GRANT EXECUTE ON FUNCTION public.generate_shared_link_token TO authenticated, service_role;

-- ========================================
-- VALIDATION FUNCTION
-- ========================================

-- Function to validate and get link info
CREATE OR REPLACE FUNCTION public.validate_shared_link(link_token text)
RETURNS TABLE (
  is_valid boolean,
  link_id uuid,
  status text,
  expires_at timestamp with time zone,
  recipient_email text,
  max_uses integer,
  current_uses integer,
  remaining_uses integer,
  linked_inspection_ids uuid[],
  error_message text
) 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  link_record record;
  inspection_ids uuid[];
BEGIN
  -- Try to find the link
  SELECT * INTO link_record 
  FROM public.shared_links 
  WHERE token = link_token;
  
  -- Get linked inspection IDs
  IF FOUND THEN
    SELECT ARRAY_AGG(inspection_id) INTO inspection_ids
    FROM public.shared_link_inspections
    WHERE shared_link_id = link_record.id;
  END IF;
  
  -- Link doesn't exist
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      false, 
      NULL::uuid, 
      NULL::text, 
      NULL::timestamp with time zone, 
      NULL::text,
      NULL::integer, 
      NULL::integer,
      NULL::integer,
      NULL::uuid[],
      'Invalid or non-existent shared link'::text;
    RETURN;
  END IF;
  
  -- Link is expired
  IF link_record.expires_at <= now() THEN
    -- Update status to expired if still active
    IF link_record.status = 'active' THEN
      UPDATE public.shared_links 
      SET status = 'expired' 
      WHERE id = link_record.id;
      link_record.status := 'expired';
    END IF;
    
    RETURN QUERY SELECT 
      false, 
      link_record.id, 
      link_record.status, 
      link_record.expires_at,
      link_record.recipient_email,
      link_record.max_uses, 
      link_record.current_uses,
      (link_record.max_uses - link_record.current_uses)::integer,
      inspection_ids,
      'Shared link has expired'::text;
    RETURN;
  END IF;
  
  -- Link has reached max uses
  IF link_record.current_uses >= link_record.max_uses THEN
    -- Update status to used if still active
    IF link_record.status = 'active' THEN
      UPDATE public.shared_links 
      SET status = 'used' 
      WHERE id = link_record.id;
      link_record.status := 'used';
    END IF;
    
    RETURN QUERY SELECT 
      false, 
      link_record.id, 
      link_record.status, 
      link_record.expires_at,
      link_record.recipient_email,
      link_record.max_uses, 
      link_record.current_uses,
      0::integer,
      inspection_ids,
      'Shared link has reached maximum uses'::text;
    RETURN;
  END IF;
  
  -- Link is not active (revoked, used, completed, etc.)
  IF link_record.status != 'active' THEN
    RETURN QUERY SELECT 
      false, 
      link_record.id, 
      link_record.status, 
      link_record.expires_at,
      link_record.recipient_email,
      link_record.max_uses, 
      link_record.current_uses,
      (link_record.max_uses - link_record.current_uses)::integer,
      inspection_ids,
      ('Shared link is ' || link_record.status)::text;
    RETURN;
  END IF;
  
  -- Link is valid
  RETURN QUERY SELECT 
    true, 
    link_record.id, 
    link_record.status, 
    link_record.expires_at,
    link_record.recipient_email,
    link_record.max_uses, 
    link_record.current_uses,
    (link_record.max_uses - link_record.current_uses)::integer,
    inspection_ids,
    NULL::text;
END;
$$;

COMMENT ON FUNCTION public.validate_shared_link IS 'Validate a shared link and return its status, usage details, and linked inspection IDs';

GRANT EXECUTE ON FUNCTION public.validate_shared_link TO anon, authenticated, service_role;

-- ========================================
-- ACCESS TRACKING FUNCTION
-- ========================================

-- Function to mark link as accessed (increments current_uses)
CREATE OR REPLACE FUNCTION public.mark_shared_link_accessed(link_token text)
RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  link_record record;
  new_uses integer;
BEGIN
  -- Get the link with row lock
  SELECT * INTO link_record 
  FROM public.shared_links 
  WHERE token = link_token
  FOR UPDATE;
  
  -- Link doesn't exist
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link not found'
    );
  END IF;
  
  -- Check if expired
  IF link_record.expires_at <= now() THEN
    -- Update status to expired if still active
    IF link_record.status = 'active' THEN
      UPDATE public.shared_links 
      SET status = 'expired' 
      WHERE id = link_record.id;
    END IF;
    
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link has expired',
      'expires_at', link_record.expires_at
    );
  END IF;
  
  -- Check if max uses reached
  IF link_record.current_uses >= link_record.max_uses THEN
    -- Update status to used if still active
    IF link_record.status = 'active' THEN
      UPDATE public.shared_links 
      SET status = 'used' 
      WHERE id = link_record.id;
    END IF;
    
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link has reached maximum uses',
      'max_uses', link_record.max_uses,
      'current_uses', link_record.current_uses
    );
  END IF;
  
  -- Check if link is active
  IF link_record.status != 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link is not active',
      'status', link_record.status
    );
  END IF;
  
  -- Calculate new usage count
  new_uses := link_record.current_uses + 1;
  
  -- Increment usage and update timestamps
  UPDATE public.shared_links 
  SET 
    current_uses = new_uses,
    last_accessed_at = now(),
    first_accessed_at = COALESCE(first_accessed_at, now())
  WHERE id = link_record.id;
  
  RETURN jsonb_build_object(
    'success', true,
    'current_uses', new_uses,
    'max_uses', link_record.max_uses,
    'remaining_uses', link_record.max_uses - new_uses
  );
END;
$$;

COMMENT ON FUNCTION public.mark_shared_link_accessed IS 'Mark a shared link as accessed, increment current_uses, and update timestamps';

GRANT EXECUTE ON FUNCTION public.mark_shared_link_accessed TO anon, authenticated, service_role;

-- ========================================
-- INSPECTION LINKING FUNCTION
-- ========================================

-- Function to link inspection to shared link
CREATE OR REPLACE FUNCTION public.link_inspection_to_shared_link(
  link_token text, 
  inspection_uuid uuid
)
RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  link_record record;
  inspection_count integer;
BEGIN
  -- Get the link with row lock to prevent race conditions
  SELECT * INTO link_record 
  FROM public.shared_links 
  WHERE token = link_token 
  FOR UPDATE;
  
  -- Link doesn't exist
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link not found'
    );
  END IF;
  
  -- Check if this inspection is already linked
  IF EXISTS (
    SELECT 1 FROM public.shared_link_inspections 
    WHERE inspection_id = inspection_uuid
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This inspection is already linked to a shared link'
    );
  END IF;
  
  -- Link is expired
  IF link_record.expires_at <= now() THEN
    -- Update status to expired if still active
    IF link_record.status = 'active' THEN
      UPDATE public.shared_links 
      SET status = 'expired' 
      WHERE id = link_record.id;
    END IF;
    
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link has expired',
      'expires_at', link_record.expires_at
    );
  END IF;
  
  -- Check if max uses would be exceeded
  IF link_record.current_uses >= link_record.max_uses THEN
    -- Update status to used if still active
    IF link_record.status = 'active' THEN
      UPDATE public.shared_links 
      SET status = 'used' 
      WHERE id = link_record.id;
    END IF;
    
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link has reached maximum uses',
      'max_uses', link_record.max_uses,
      'current_uses', link_record.current_uses
    );
  END IF;
  
  -- Link is not active
  IF link_record.status != 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link is not active',
      'status', link_record.status
    );
  END IF;
  
  -- Link the inspection to the shared link
  INSERT INTO public.shared_link_inspections (shared_link_id, inspection_id)
  VALUES (link_record.id, inspection_uuid);
  
  -- Increment current_uses
  UPDATE public.shared_links 
  SET current_uses = current_uses + 1
  WHERE id = link_record.id;
  
  -- Get updated inspection count
  SELECT COUNT(*) INTO inspection_count
  FROM public.shared_link_inspections
  WHERE shared_link_id = link_record.id;
  
  RETURN jsonb_build_object(
    'success', true,
    'link_id', link_record.id,
    'inspection_id', inspection_uuid,
    'current_uses', inspection_count,
    'max_uses', link_record.max_uses,
    'remaining_uses', link_record.max_uses - inspection_count,
    'message', 'Inspection successfully linked to shared link'
  );
END;
$$;

COMMENT ON FUNCTION public.link_inspection_to_shared_link IS 'Link an inspection to shared link (can link multiple inspections up to max_uses)';

GRANT EXECUTE ON FUNCTION public.link_inspection_to_shared_link TO anon, authenticated, service_role;

-- ========================================
-- COMPLETION FUNCTION
-- ========================================

-- Function to mark shared link as completed
CREATE OR REPLACE FUNCTION public.complete_shared_link(link_token text)
RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  link_record record;
  inspection_count integer;
BEGIN
  -- Get the link with row lock
  SELECT * INTO link_record 
  FROM public.shared_links 
  WHERE token = link_token 
  FOR UPDATE;
  
  -- Link doesn't exist
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link not found'
    );
  END IF;
  
  -- Get count of linked inspections
  SELECT COUNT(*) INTO inspection_count
  FROM public.shared_link_inspections
  WHERE shared_link_id = link_record.id;
  
  -- Can only complete if at least one inspection is linked
  IF inspection_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot complete - no inspections linked to this shared link'
    );
  END IF;
  
  -- Update status to completed
  UPDATE public.shared_links 
  SET 
    status = 'completed',
    completed_at = now()
  WHERE id = link_record.id;
  
  RETURN jsonb_build_object(
    'success', true,
    'link_id', link_record.id,
    'inspection_count', inspection_count,
    'completed_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.complete_shared_link IS 'Mark a shared link as completed';

GRANT EXECUTE ON FUNCTION public.complete_shared_link TO anon, authenticated, service_role;

-- ========================================
-- REVOCATION FUNCTION
-- ========================================

-- Function to revoke a shared link
CREATE OR REPLACE FUNCTION public.revoke_shared_link(
  link_token text,
  revoker_uuid uuid,
  reason text DEFAULT NULL
)
RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
  link_record record;
  rows_updated integer;
BEGIN
  -- Get the link with row lock
  SELECT * INTO link_record
  FROM public.shared_links 
  WHERE token = link_token
  FOR UPDATE;
  
  -- Link doesn't exist
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Shared link not found'
    );
  END IF;
  
  -- Can only revoke active links
  IF link_record.status != 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot revoke link - link is already ' || link_record.status,
      'current_status', link_record.status
    );
  END IF;
  
  -- Revoke the link
  UPDATE public.shared_links 
  SET 
    status = 'revoked',
    revoked_at = now(),
    revoked_by = revoker_uuid,
    revoke_reason = reason
  WHERE id = link_record.id;
  
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', rows_updated > 0,
    'link_id', link_record.id,
    'revoked_at', now(),
    'revoked_by', revoker_uuid,
    'reason', reason
  );
END;
$$;

COMMENT ON FUNCTION public.revoke_shared_link IS 'Revoke an active shared link';

GRANT EXECUTE ON FUNCTION public.revoke_shared_link TO authenticated, service_role;

-- ========================================
-- STATISTICS FUNCTION
-- ========================================

-- Function to get shared link statistics
CREATE OR REPLACE FUNCTION public.get_shared_link_stats(admin_uuid uuid DEFAULT NULL)
RETURNS TABLE (
  total_links bigint,
  active_links bigint,
  expired_links bigint,
  used_links bigint,
  revoked_links bigint,
  completed_links bigint,
  total_inspections_linked bigint,
  links_expiring_soon bigint,
  total_uses bigint,
  average_uses_per_link numeric
) 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(DISTINCT sl.id)::bigint as total_links,
    COUNT(DISTINCT sl.id) FILTER (WHERE sl.status = 'active')::bigint as active_links,
    COUNT(DISTINCT sl.id) FILTER (WHERE sl.status = 'expired')::bigint as expired_links,
    COUNT(DISTINCT sl.id) FILTER (WHERE sl.status = 'used')::bigint as used_links,
    COUNT(DISTINCT sl.id) FILTER (WHERE sl.status = 'revoked')::bigint as revoked_links,
    COUNT(DISTINCT sl.id) FILTER (WHERE sl.status = 'completed')::bigint as completed_links,
    COUNT(DISTINCT sli.inspection_id)::bigint as total_inspections_linked,
    COUNT(DISTINCT sl.id) FILTER (WHERE sl.status = 'active' AND sl.expires_at <= now() + interval '24 hours')::bigint as links_expiring_soon,
    COALESCE(SUM(sl.current_uses), 0)::bigint as total_uses,
    ROUND(COALESCE(AVG(sl.current_uses), 0), 2)::numeric as average_uses_per_link
  FROM public.shared_links sl
  LEFT JOIN public.shared_link_inspections sli ON sli.shared_link_id = sl.id
  WHERE admin_uuid IS NULL OR sl.created_by = admin_uuid;
END;
$$;

COMMENT ON FUNCTION public.get_shared_link_stats IS 'Get statistics about shared links including total usage counts and linked inspections (optionally filtered by admin)';

GRANT EXECUTE ON FUNCTION public.get_shared_link_stats TO authenticated, service_role;

-- ========================================
-- DETAILS FUNCTION
-- ========================================

-- Function to get link details by token
CREATE OR REPLACE FUNCTION public.get_shared_link_details(link_token text)
RETURNS TABLE (
  id uuid,
  token text,
  status text,
  created_by uuid,
  created_by_name text,
  recipient_email text,
  linked_inspection_ids uuid[],
  inspection_count integer,
  expires_at timestamp with time zone,
  max_uses integer,
  current_uses integer,
  remaining_uses integer,
  metadata jsonb,
  first_accessed_at timestamp with time zone,
  last_accessed_at timestamp with time zone,
  completed_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  revoked_by_name text,
  revoke_reason text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
) 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sl.id,
    sl.token,
    sl.status,
    sl.created_by,
    COALESCE(p1.first_name || ' ' || p1.last_name, p1.email) as created_by_name,
    sl.recipient_email,
    ARRAY(
      SELECT sli.inspection_id 
      FROM public.shared_link_inspections sli 
      WHERE sli.shared_link_id = sl.id
      ORDER BY sli.created_at
    ) as linked_inspection_ids,
    (
      SELECT COUNT(*)::integer 
      FROM public.shared_link_inspections sli 
      WHERE sli.shared_link_id = sl.id
    ) as inspection_count,
    sl.expires_at,
    sl.max_uses,
    sl.current_uses,
    (sl.max_uses - sl.current_uses)::integer as remaining_uses,
    sl.metadata,
    sl.first_accessed_at,
    sl.last_accessed_at,
    sl.completed_at,
    sl.revoked_at,
    sl.revoked_by,
    COALESCE(p2.first_name || ' ' || p2.last_name, p2.email) as revoked_by_name,
    sl.revoke_reason,
    sl.created_at,
    sl.updated_at
  FROM public.shared_links sl
  LEFT JOIN public.profiles p1 ON p1.id = sl.created_by
  LEFT JOIN public.profiles p2 ON p2.id = sl.revoked_by
  WHERE sl.token = link_token;
END;
$$;

COMMENT ON FUNCTION public.get_shared_link_details IS 'Get complete details for a shared link including all linked inspection IDs and usage information';

GRANT EXECUTE ON FUNCTION public.get_shared_link_details TO anon, authenticated, service_role;

-- ========================================
-- HELPER FUNCTION TO GET INSPECTIONS FOR A LINK
-- ========================================

-- Function to get all inspections linked to a shared link
CREATE OR REPLACE FUNCTION public.get_shared_link_inspections(link_token text)
RETURNS TABLE (
  inspection_id uuid,
  linked_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sli.inspection_id,
    sli.created_at as linked_at
  FROM public.shared_link_inspections sli
  INNER JOIN public.shared_links sl ON sl.id = sli.shared_link_id
  WHERE sl.token = link_token
  ORDER BY sli.created_at;
END;
$$;

COMMENT ON FUNCTION public.get_shared_link_inspections IS 'Get all inspections linked to a specific shared link';

GRANT EXECUTE ON FUNCTION public.get_shared_link_inspections TO anon, authenticated, service_role;
