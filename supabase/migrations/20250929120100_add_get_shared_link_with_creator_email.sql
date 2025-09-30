-- Migration: Add function to get shared link with creator email
-- Description: Fetches shared link details along with the creator's email from profiles table using created_by

-- ========================================
-- FUNCTION TO GET SHARED LINK WITH CREATOR EMAIL
-- ========================================

CREATE OR REPLACE FUNCTION public.get_shared_link_with_creator_email(link_token text)
RETURNS TABLE (
  id uuid,
  token text,
  creator_email text,
  creator_first_name text,
  creator_last_name text,
  creator_phone_number text,
  created_by uuid,
  recipient_email text,
  expires_at timestamp with time zone,
  max_uses integer,
  current_uses integer,
  remaining_uses integer,
  status text,
  metadata jsonb,
  first_accessed_at timestamp with time zone,
  last_accessed_at timestamp with time zone,
  completed_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  linked_inspection_ids uuid[],
  inspection_count integer
) 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sl.id,
    sl.token,
    p.email as creator_email,
    p.first_name as creator_first_name,
    p.last_name as creator_last_name,
    p.phone_number as creator_phone_number,
    sl.created_by,
    sl.recipient_email,
    sl.expires_at,
    sl.max_uses,
    sl.current_uses,
    (sl.max_uses - sl.current_uses)::integer as remaining_uses,
    sl.status,
    sl.metadata,
    sl.first_accessed_at,
    sl.last_accessed_at,
    sl.completed_at,
    sl.revoked_at,
    sl.revoked_by,
    sl.revoke_reason,
    sl.created_at,
    sl.updated_at,
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
    ) as inspection_count
  FROM public.shared_links sl
  INNER JOIN public.profiles p ON p.id = sl.created_by
  WHERE sl.token = link_token;
END;
$$;

COMMENT ON FUNCTION public.get_shared_link_with_creator_email IS 'Get shared link details including creator email, name, and phone from profiles table using created_by field';

-- Grant execute permissions to all roles that can use shared links
GRANT EXECUTE ON FUNCTION public.get_shared_link_with_creator_email TO anon, authenticated, service_role;
