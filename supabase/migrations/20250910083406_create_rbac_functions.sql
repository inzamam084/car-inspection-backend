-- Create RBAC utility functions
-- This migration creates helper functions for the RBAC system

-- Create function to get user permissions
CREATE OR REPLACE FUNCTION public.get_user_permissions(user_uuid uuid)
RETURNS TABLE(permission_name text, resource text, action text) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT p.name, p.resource, p.action
  FROM public.permissions p
  JOIN public.role_permissions rp ON p.id = rp.permission_id
  JOIN public.roles r ON r.id = rp.role_id
  JOIN public.user_roles ur ON ur.role_id = r.id
  WHERE ur.user_id = user_uuid 
  AND ur.is_active = true
  AND (ur.expires_at IS NULL OR ur.expires_at > now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check if user has permission
CREATE OR REPLACE FUNCTION public.user_has_permission(user_uuid uuid, permission_name text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.get_user_permissions(user_uuid) 
    WHERE permission_name = get_user_permissions.permission_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments for documentation
COMMENT ON FUNCTION public.get_user_permissions(uuid) IS 'Returns all permissions for a given user';
COMMENT ON FUNCTION public.user_has_permission(uuid, text) IS 'Checks if user has a specific permission';
