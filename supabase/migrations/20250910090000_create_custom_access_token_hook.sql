-- Custom Access Token Hook Migration
-- This migration implements a custom access token hook that integrates with your existing RBAC system
-- Based on Supabase's official documentation: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook

-- Create the custom access token hook function
-- This function runs before a token is issued and adds custom claims based on user roles
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  user_roles_array text[];
  user_permissions_array text[];
  user_profile record;
  role_record record;
BEGIN
  -- Get the claims from the event
  claims := event->'claims';
  
  -- Get user profile information
  SELECT 
    first_name,
    last_name,
    email,
    phone_number,
    is_active
  INTO user_profile
  FROM public.profiles 
  WHERE id = (event->>'user_id')::uuid;
  
  -- Get all active user roles
  SELECT 
    array_agg(DISTINCT r.name) 
  INTO user_roles_array
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = (event->>'user_id')::uuid
  AND ur.is_active = true
  AND (ur.expires_at IS NULL OR ur.expires_at > now());
  
  -- Get all user permissions through roles
  SELECT 
    array_agg(DISTINCT p.name)
  INTO user_permissions_array
  FROM public.permissions p
  JOIN public.role_permissions rp ON p.id = rp.permission_id
  JOIN public.roles r ON r.id = rp.role_id
  JOIN public.user_roles ur ON ur.role_id = r.id
  WHERE ur.user_id = (event->>'user_id')::uuid
  AND ur.is_active = true
  AND (ur.expires_at IS NULL OR ur.expires_at > now());
  
  -- Initialize app_metadata if it doesn't exist
  IF jsonb_typeof(claims->'app_metadata') IS NULL THEN
    claims := jsonb_set(claims, '{app_metadata}', '{}');
  END IF;
  
  -- Add custom claims to app_metadata
  claims := jsonb_set(claims, '{app_metadata,user_roles}', to_jsonb(COALESCE(user_roles_array, ARRAY[]::text[])));
  claims := jsonb_set(claims, '{app_metadata,permissions}', to_jsonb(COALESCE(user_permissions_array, ARRAY[]::text[])));
  
  -- Add user profile information
  IF user_profile IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata,profile}', jsonb_build_object(
      'first_name', user_profile.first_name,
      'last_name', user_profile.last_name,
      'phone_number', user_profile.phone_number,
      'is_active', user_profile.is_active
    ));
  END IF;
  
  -- Add convenience role checks for your actual roles
  claims := jsonb_set(claims, '{app_metadata,is_admin}', 
    to_jsonb('admin' = ANY(COALESCE(user_roles_array, ARRAY[]::text[]))));
  claims := jsonb_set(claims, '{app_metadata,is_super_admin}', 
    to_jsonb('super_admin' = ANY(COALESCE(user_roles_array, ARRAY[]::text[]))));
  claims := jsonb_set(claims, '{app_metadata,is_user}', 
    to_jsonb('user' = ANY(COALESCE(user_roles_array, ARRAY[]::text[]))));  
  -- Combined admin check (admin OR super_admin)
  claims := jsonb_set(claims, '{app_metadata,is_any_admin}', 
    to_jsonb('admin' = ANY(COALESCE(user_roles_array, ARRAY[]::text[])) OR 'super_admin' = ANY(COALESCE(user_roles_array, ARRAY[]::text[]))));
  
  -- Update the claims in the event
  event := jsonb_set(event, '{claims}', claims);
  
  -- Return the modified event
  RETURN event;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't fail the authentication
    INSERT INTO public.function_logs (function_name, error_message, record_id)
    VALUES ('custom_access_token_hook', SQLERRM, (event->>'user_id')::uuid)
    ON CONFLICT DO NOTHING;
    
    -- Return the original event if there's an error
    RETURN event;
END;
$$;

-- Grant necessary permissions for the auth hook
-- The supabase_auth_admin role needs to execute this function
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Revoke permissions from other roles for security
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- Grant access to tables that the hook needs to read
GRANT SELECT ON TABLE public.profiles TO supabase_auth_admin;
GRANT SELECT ON TABLE public.roles TO supabase_auth_admin;
GRANT SELECT ON TABLE public.permissions TO supabase_auth_admin;
GRANT SELECT ON TABLE public.user_roles TO supabase_auth_admin;
GRANT SELECT ON TABLE public.role_permissions TO supabase_auth_admin;

-- Grant insert access to function_logs for error logging
GRANT INSERT ON TABLE public.function_logs TO supabase_auth_admin;

-- Add helper functions to work with custom claims in your application

-- Function to check if user has a specific role from JWT claims
CREATE OR REPLACE FUNCTION public.jwt_has_role(role_name text)
RETURNS boolean AS $$
DECLARE
  user_roles jsonb;
BEGIN
  user_roles := auth.jwt() -> 'app_metadata' -> 'user_roles';
  
  IF user_roles IS NULL THEN
    RETURN false;
  END IF;
  
  RETURN user_roles ? role_name;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Function to check if user has a specific permission from JWT claims
CREATE OR REPLACE FUNCTION public.jwt_has_permission(permission_name text)
RETURNS boolean AS $$
DECLARE
  user_permissions jsonb;
BEGIN
  user_permissions := auth.jwt() -> 'app_metadata' -> 'permissions';
  
  IF user_permissions IS NULL THEN
    RETURN false;
  END IF;
  
  RETURN user_permissions ? permission_name;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Function to get all user roles from JWT
CREATE OR REPLACE FUNCTION public.jwt_get_roles()
RETURNS text[] AS $$
DECLARE
  user_roles jsonb;
BEGIN
  user_roles := auth.jwt() -> 'app_metadata' -> 'user_roles';
  
  IF user_roles IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  
  RETURN ARRAY(SELECT jsonb_array_elements_text(user_roles));
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Function to get all user permissions from JWT
CREATE OR REPLACE FUNCTION public.jwt_get_permissions()
RETURNS text[] AS $$
DECLARE
  user_permissions jsonb;
BEGIN
  user_permissions := auth.jwt() -> 'app_metadata' -> 'permissions';
  
  IF user_permissions IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  
  RETURN ARRAY(SELECT jsonb_array_elements_text(user_permissions));
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Example RLS policies using the custom claims
-- You can use these as templates for your existing tables

-- Example: Only allow users with admin roles to access all inspections
-- CREATE POLICY "Admins can view all inspections" ON public.inspections
-- FOR SELECT 
-- USING (
--   public.jwt_has_role('admin') OR 
--   public.jwt_has_role('super_admin')
-- );

-- Example: Allow users to view inspections they own or if they have permission
-- CREATE POLICY "Users can view own inspections or with permission" ON public.inspections
-- FOR SELECT 
-- USING (
--   auth.uid() = user_id OR 
--   public.jwt_has_permission('inspections:read') OR
--   public.jwt_has_role('admin') OR
--   public.jwt_has_role('super_admin')
-- );

-- Example: Only allow users with specific permission to create inspections
-- CREATE POLICY "Users with permission can create inspections" ON public.inspections
-- FOR INSERT 
-- WITH CHECK (
--   public.jwt_has_permission('inspections:create') OR
--   public.jwt_has_role('admin') OR
--   public.jwt_has_role('super_admin')
-- );

-- Grant permissions for the helper functions
GRANT EXECUTE ON FUNCTION public.jwt_has_role TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.jwt_has_permission TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.jwt_get_roles TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.jwt_get_permissions TO authenticated, anon;

-- Add comment for documentation
COMMENT ON FUNCTION public.custom_access_token_hook IS 'Custom access token hook that adds RBAC claims to JWT tokens. Integrates with the existing roles and permissions system.';
COMMENT ON FUNCTION public.jwt_has_role IS 'Check if the current user has a specific role based on JWT claims';
COMMENT ON FUNCTION public.jwt_has_permission IS 'Check if the current user has a specific permission based on JWT claims';
COMMENT ON FUNCTION public.jwt_get_roles IS 'Get all roles for the current user from JWT claims';
COMMENT ON FUNCTION public.jwt_get_permissions IS 'Get all permissions for the current user from JWT claims';
