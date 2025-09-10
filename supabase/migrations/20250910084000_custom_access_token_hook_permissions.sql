-- Fix Custom Access Token Hook Permissions
-- This migration fixes permission issues with the custom access token hook

-- First, ensure supabase_auth_admin has all necessary permissions
-- Grant usage on schema public to supabase_auth_admin
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- Grant select permissions on all necessary tables
GRANT SELECT ON public.profiles TO supabase_auth_admin;
GRANT SELECT ON public.roles TO supabase_auth_admin;
GRANT SELECT ON public.permissions TO supabase_auth_admin;
GRANT SELECT ON public.role_permissions TO supabase_auth_admin;
GRANT SELECT ON public.user_roles TO supabase_auth_admin;

-- Grant execute permissions on all necessary functions
GRANT EXECUTE ON FUNCTION public.get_user_permissions(uuid) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.get_custom_claims(uuid) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- Ensure the custom access token hook function is properly defined with error handling
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_profile record;
  user_permissions text[];
  claims jsonb;
  user_id uuid;
BEGIN
  -- Extract user ID from the event
  user_id := (event->>'user_id')::uuid;
  
  -- If user_id is null, return event with minimal claims
  IF user_id IS NULL THEN
    event := jsonb_set(event, '{claims, role}', '"user"');
    event := jsonb_set(event, '{claims, permissions}', '[]'::jsonb);
    event := jsonb_set(event, '{claims, is_active}', 'true'::jsonb);
    event := jsonb_set(event, '{claims, dashboard_type}', '"user"');
    RETURN event;
  END IF;
  
  -- Get user profile information with error handling
  BEGIN
    SELECT role, is_active, first_name, last_name
    INTO user_profile
    FROM public.profiles
    WHERE id = user_id;
  EXCEPTION
    WHEN OTHERS THEN
      -- If profile lookup fails, return minimal claims
      event := jsonb_set(event, '{claims, role}', '"user"');
      event := jsonb_set(event, '{claims, permissions}', '[]'::jsonb);
      event := jsonb_set(event, '{claims, is_active}', 'true'::jsonb);
      event := jsonb_set(event, '{claims, dashboard_type}', '"user"');
      RETURN event;
  END;

  -- If user not found or inactive, return minimal claims
  IF user_profile IS NULL OR user_profile.is_active = false THEN
    event := jsonb_set(event, '{claims, role}', '"user"');
    event := jsonb_set(event, '{claims, permissions}', '[]'::jsonb);
    event := jsonb_set(event, '{claims, is_active}', 'false'::jsonb);
    event := jsonb_set(event, '{claims, dashboard_type}', '"user"');
    RETURN event;
  END IF;

  -- Get user permissions with error handling
  BEGIN
    SELECT array_agg(permission_name)
    INTO user_permissions
    FROM public.get_user_permissions(user_id);
  EXCEPTION
    WHEN OTHERS THEN
      user_permissions := ARRAY[]::text[];
  END;

  -- Build custom claims and add them to the event
  event := jsonb_set(event, '{claims, role}', to_jsonb(COALESCE(user_profile.role, 'user')));
  event := jsonb_set(event, '{claims, permissions}', COALESCE(to_jsonb(user_permissions), '[]'::jsonb));
  event := jsonb_set(event, '{claims, is_active}', to_jsonb(COALESCE(user_profile.is_active, true)));
  event := jsonb_set(event, '{claims, full_name}', to_jsonb(TRIM(CONCAT(COALESCE(user_profile.first_name, ''), ' ', COALESCE(user_profile.last_name, '')))));
  event := jsonb_set(event, '{claims, dashboard_type}', to_jsonb(CASE 
    WHEN user_profile.role = 'super_admin' THEN 'super_admin'
    WHEN user_profile.role = 'admin' THEN 'admin'
    ELSE 'user'
  END));

  RETURN event;
EXCEPTION
  WHEN OTHERS THEN
    -- On any error, return event with minimal claims to prevent auth failure
    event := jsonb_set(event, '{claims, role}', '"user"');
    event := jsonb_set(event, '{claims, permissions}', '[]'::jsonb);
    event := jsonb_set(event, '{claims, is_active}', 'true'::jsonb);
    event := jsonb_set(event, '{claims, dashboard_type}', '"user"');
    RETURN event;
END;
$$;

-- Ensure the get_user_permissions function has proper permissions and error handling
CREATE OR REPLACE FUNCTION public.get_user_permissions(user_uuid uuid)
RETURNS TABLE(permission_name text, resource text, action text) 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
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
EXCEPTION
  WHEN OTHERS THEN
    -- Return empty result set on error
    RETURN;
END;
$$;

-- Grant additional permissions that might be needed
GRANT SELECT ON ALL TABLES IN SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO supabase_auth_admin;

-- Specifically grant permissions on sequences if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema = 'public') THEN
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO supabase_auth_admin;
  END IF;
END $$;

-- Ensure supabase_auth_admin can access the auth schema if needed
GRANT USAGE ON SCHEMA auth TO supabase_auth_admin;

-- Add comment for documentation
COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS 'Custom access token hook with enhanced error handling and proper permissions for supabase_auth_admin';
