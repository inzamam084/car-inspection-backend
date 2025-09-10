-- Fix Auth Permissions for Custom Access Token Hook
-- This migration fixes permission issues with the custom access token hook

-- Grant necessary permissions to supabase_auth_admin
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO supabase_auth_admin;

-- Specifically grant permissions on the tables needed for RBAC
GRANT SELECT ON public.profiles TO supabase_auth_admin;
GRANT SELECT ON public.roles TO supabase_auth_admin;
GRANT SELECT ON public.permissions TO supabase_auth_admin;
GRANT SELECT ON public.role_permissions TO supabase_auth_admin;
GRANT SELECT ON public.user_roles TO supabase_auth_admin;

-- Grant execute permissions on the specific functions needed
GRANT EXECUTE ON FUNCTION public.get_user_primary_role(uuid) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.get_custom_claims(uuid) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(uuid) TO supabase_auth_admin;

-- Grant insert permissions for logging
GRANT INSERT ON public.function_logs TO supabase_auth_admin;

-- Ensure supabase_auth_admin can access sequences if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema = 'public') THEN
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO supabase_auth_admin;
  END IF;
END $$;

-- Create a simplified custom access token hook that handles permission errors gracefully
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  custom_claims jsonb;
  user_id uuid;
  user_exists boolean := false;
  user_role text := 'user';
  user_permissions text[] := ARRAY[]::text[];
  user_profile record;
BEGIN
  -- Extract user ID from the event
  user_id := (event->>'user_id')::uuid;
  
  -- If user_id is null, add minimal custom claims
  IF user_id IS NULL THEN
    custom_claims := jsonb_build_object(
      'role', 'user',
      'permissions', '[]'::jsonb,
      'is_active', true,
      'dashboard_type', 'user'
    );
    -- Add custom claims to existing claims
    event := jsonb_set(event, '{claims}', COALESCE(event->'claims', '{}'::jsonb) || custom_claims);
    RETURN event;
  END IF;
  
  -- Try to get user profile with error handling
  BEGIN
    SELECT is_active, first_name, last_name
    INTO user_profile
    FROM public.profiles
    WHERE id = user_id;
    
    user_exists := (user_profile IS NOT NULL);
  EXCEPTION
    WHEN OTHERS THEN
      user_exists := false;
  END;
  
  -- If user doesn't exist or is inactive, add minimal custom claims
  IF NOT user_exists OR (user_profile IS NOT NULL AND user_profile.is_active = false) THEN
    custom_claims := jsonb_build_object(
      'role', 'user',
      'permissions', '[]'::jsonb,
      'is_active', false,
      'dashboard_type', 'user'
    );
    -- Add custom claims to existing claims
    event := jsonb_set(event, '{claims}', COALESCE(event->'claims', '{}'::jsonb) || custom_claims);
    RETURN event;
  END IF;
  
  -- Try to get user's primary role with error handling
  BEGIN
    SELECT r.name INTO user_role
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = user_id 
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
    ORDER BY 
      CASE r.name
        WHEN 'super_admin' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'user' THEN 3
        ELSE 4
      END
    LIMIT 1;
    
    user_role := COALESCE(user_role, 'user');
  EXCEPTION
    WHEN OTHERS THEN
      user_role := 'user';
  END;
  
  -- Try to get user permissions with error handling
  BEGIN
    SELECT array_agg(DISTINCT p.name)
    INTO user_permissions
    FROM public.permissions p
    JOIN public.role_permissions rp ON p.id = rp.permission_id
    JOIN public.roles r ON r.id = rp.role_id
    JOIN public.user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = user_id 
    AND ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > now());
    
    user_permissions := COALESCE(user_permissions, ARRAY[]::text[]);
  EXCEPTION
    WHEN OTHERS THEN
      user_permissions := ARRAY[]::text[];
  END;
  
  -- Build custom claims
  custom_claims := jsonb_build_object(
    'role', user_role,
    'permissions', to_jsonb(user_permissions),
    'is_active', COALESCE(user_profile.is_active, true),
    'full_name', TRIM(CONCAT(COALESCE(user_profile.first_name, ''), ' ', COALESCE(user_profile.last_name, ''))),
    'dashboard_type', CASE 
      WHEN user_role = 'super_admin' THEN 'super_admin'
      WHEN user_role = 'admin' THEN 'admin'
      ELSE 'user'
    END,
    'claims_generated_at', extract(epoch from now())
  );
  
  -- Add custom claims to existing claims (merge with existing claims)
  event := jsonb_set(event, '{claims}', COALESCE(event->'claims', '{}'::jsonb) || custom_claims);
  
  RETURN event;
EXCEPTION
  WHEN OTHERS THEN
    -- On any error, add minimal safe custom claims
    custom_claims := jsonb_build_object(
      'role', 'user',
      'permissions', '[]'::jsonb,
      'is_active', true,
      'dashboard_type', 'user',
      'error', 'Claims generation failed'
    );
    
    -- Add custom claims to existing claims
    event := jsonb_set(event, '{claims}', COALESCE(event->'claims', '{}'::jsonb) || custom_claims);
    
    -- Try to log the error, but don't fail if logging fails
    BEGIN
      INSERT INTO public.function_logs (function_name, error_message, record_id)
      VALUES ('custom_access_token_hook', CONCAT('Error: ', SQLERRM), user_id);
    EXCEPTION
      WHEN OTHERS THEN
        -- Ignore logging errors
        NULL;
    END;
    
    RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the updated function
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- Add comment
COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS 'Custom access token hook with enhanced error handling and proper permissions';
