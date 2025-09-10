-- Fix Custom Claims to Use Proper RBAC System
-- This migration fixes the custom claims functions to use the user_roles table
-- instead of the profiles.role column for proper role-based access control

-- Create function to get user's primary role from user_roles table
CREATE OR REPLACE FUNCTION public.get_user_primary_role(user_uuid uuid)
RETURNS text AS $$
DECLARE
  primary_role text;
BEGIN
  -- Get the user's primary active role from user_roles table
  -- Priority: super_admin > admin > user
  SELECT r.name INTO primary_role
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = user_uuid 
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
  
  -- Return 'user' as default if no role found
  RETURN COALESCE(primary_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the get_custom_claims function to use RBAC system
CREATE OR REPLACE FUNCTION public.get_custom_claims(user_uuid uuid)
RETURNS jsonb AS $$
DECLARE
  user_profile record;
  user_permissions text[];
  user_role text;
  claims jsonb;
BEGIN
  -- Get user profile information (excluding role)
  SELECT is_active, first_name, last_name
  INTO user_profile
  FROM public.profiles
  WHERE id = user_uuid;

  -- If user not found or inactive, return minimal claims
  IF user_profile IS NULL OR user_profile.is_active = false THEN
    RETURN jsonb_build_object(
      'role', 'user',
      'permissions', '[]'::jsonb,
      'is_active', false
    );
  END IF;

  -- Get user's primary role from RBAC system
  user_role := public.get_user_primary_role(user_uuid);

  -- Get user permissions from RBAC system
  SELECT array_agg(permission_name)
  INTO user_permissions
  FROM public.get_user_permissions(user_uuid);

  -- Build custom claims object using RBAC role
  claims := jsonb_build_object(
    'role', user_role,
    'permissions', COALESCE(to_jsonb(user_permissions), '[]'::jsonb),
    'is_active', COALESCE(user_profile.is_active, true),
    'full_name', CONCAT(COALESCE(user_profile.first_name, ''), ' ', COALESCE(user_profile.last_name, '')),
    'dashboard_type', CASE 
      WHEN user_role = 'super_admin' THEN 'super_admin'
      WHEN user_role = 'admin' THEN 'admin'
      ELSE 'user'
    END
  );

  RETURN claims;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update user_has_role function to use RBAC system
CREATE OR REPLACE FUNCTION public.user_has_role(user_uuid uuid, required_role text)
RETURNS boolean AS $$
DECLARE
  user_role text;
BEGIN
  -- Get user's primary role from RBAC system
  user_role := public.get_user_primary_role(user_uuid);
  
  -- Handle role hierarchy
  CASE required_role
    WHEN 'user' THEN
      RETURN user_role IN ('user', 'admin', 'super_admin');
    WHEN 'admin' THEN
      RETURN user_role IN ('admin', 'super_admin');
    WHEN 'super_admin' THEN
      RETURN user_role = 'super_admin';
    ELSE
      RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update get_dashboard_url function to use RBAC system
CREATE OR REPLACE FUNCTION public.get_dashboard_url(user_uuid uuid)
RETURNS text AS $$
DECLARE
  user_role text;
BEGIN
  -- Get user's primary role from RBAC system
  user_role := public.get_user_primary_role(user_uuid);
  
  CASE user_role
    WHEN 'super_admin' THEN
      RETURN '/admin';
    WHEN 'admin' THEN
      RETURN '/dashboard';
    ELSE
      RETURN '/dashboard';
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to invalidate user sessions when roles change
CREATE OR REPLACE FUNCTION public.invalidate_user_sessions(user_uuid uuid)
RETURNS void AS $$
BEGIN
  -- Update the user's refresh tokens to force re-authentication
  UPDATE auth.refresh_tokens 
  SET revoked = true, 
      updated_at = now()
  WHERE user_id = user_uuid;
  
  -- Log the session invalidation
  INSERT INTO public.function_logs (function_name, error_message, record_id)
  VALUES ('invalidate_user_sessions', 'Sessions invalidated due to role change', user_uuid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger function for user_roles changes
CREATE OR REPLACE FUNCTION public.refresh_claims_on_user_role_change()
RETURNS TRIGGER AS $$
DECLARE
  role_name text;
BEGIN
  -- Get role name for logging
  SELECT name INTO role_name FROM public.roles WHERE id = COALESCE(NEW.role_id, OLD.role_id);
  
  -- Log the role change
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.function_logs (function_name, error_message, record_id)
    VALUES ('user_role_assigned', CONCAT('Role "', role_name, '" assigned to user'), NEW.user_id);
    
    -- Invalidate sessions for the user
    PERFORM public.invalidate_user_sessions(NEW.user_id);
    
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Check if role changed or status changed
    IF OLD.role_id IS DISTINCT FROM NEW.role_id OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      INSERT INTO public.function_logs (function_name, error_message, record_id)
      VALUES ('user_role_updated', CONCAT('Role "', role_name, '" updated for user'), NEW.user_id);
      
      -- Invalidate sessions for the user
      PERFORM public.invalidate_user_sessions(NEW.user_id);
    END IF;
    
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.function_logs (function_name, error_message, record_id)
    VALUES ('user_role_removed', CONCAT('Role "', role_name, '" removed from user'), OLD.user_id);
    
    -- Invalidate sessions for the user
    PERFORM public.invalidate_user_sessions(OLD.user_id);
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the old trigger on profiles table
DROP TRIGGER IF EXISTS refresh_claims_on_role_change_trigger ON public.profiles;

-- Create new trigger on user_roles table
CREATE OR REPLACE TRIGGER refresh_claims_on_user_role_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_claims_on_user_role_change();

-- Update the custom access token hook with better error handling
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  claims jsonb;
  user_id uuid;
  user_exists boolean;
BEGIN
  -- Extract user ID from the event
  user_id := (event->>'user_id')::uuid;
  
  -- Check if user exists and is active
  SELECT EXISTS(
    SELECT 1 FROM public.profiles 
    WHERE id = user_id AND is_active = true
  ) INTO user_exists;
  
  -- If user doesn't exist or is inactive, return minimal claims
  IF NOT user_exists THEN
    event := jsonb_set(event, '{claims}', jsonb_build_object(
      'role', 'user',
      'permissions', '[]'::jsonb,
      'is_active', false,
      'error', 'User not found or inactive'
    ));
    RETURN event;
  END IF;
  
  -- Get custom claims for the user (now using RBAC system)
  claims := public.get_custom_claims(user_id);
  
  -- Add timestamp to track when claims were generated
  claims := jsonb_set(claims, '{claims_generated_at}', to_jsonb(extract(epoch from now())));
  
  -- Add custom claims to the JWT token
  event := jsonb_set(event, '{claims}', claims);
  
  RETURN event;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error and return minimal claims
    INSERT INTO public.function_logs (function_name, error_message, record_id)
    VALUES ('custom_access_token_hook', CONCAT('Error: ', SQLERRM), user_id);
    
    event := jsonb_set(event, '{claims}', jsonb_build_object(
      'role', 'user',
      'permissions', '[]'::jsonb,
      'is_active', false,
      'error', 'Claims generation failed'
    ));
    
    RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to manually assign role to user (helper function)
CREATE OR REPLACE FUNCTION public.assign_role_to_user(user_uuid uuid, role_name text, assigned_by_uuid uuid DEFAULT NULL)
RETURNS boolean AS $$
DECLARE
  role_uuid uuid;
  existing_role_uuid uuid;
BEGIN
  -- Get the role UUID
  SELECT id INTO role_uuid FROM public.roles WHERE name = role_name;
  
  IF role_uuid IS NULL THEN
    RAISE EXCEPTION 'Role % does not exist', role_name;
  END IF;
  
  -- Check if user already has this role
  SELECT role_id INTO existing_role_uuid 
  FROM public.user_roles 
  WHERE user_id = user_uuid AND role_id = role_uuid AND is_active = true;
  
  IF existing_role_uuid IS NOT NULL THEN
    -- User already has this role
    RETURN false;
  END IF;
  
  -- Deactivate all existing roles for the user (assuming single role per user)
  UPDATE public.user_roles 
  SET is_active = false 
  WHERE user_id = user_uuid;
  
  -- Assign the new role
  INSERT INTO public.user_roles (user_id, role_id, assigned_by)
  VALUES (user_uuid, role_uuid, assigned_by_uuid)
  ON CONFLICT (user_id, role_id) 
  DO UPDATE SET 
    is_active = true, 
    assigned_at = now(),
    assigned_by = assigned_by_uuid;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view to easily see user roles from RBAC system
CREATE OR REPLACE VIEW public.user_roles_view AS
SELECT 
  p.id as user_id,
  p.email,
  p.first_name,
  p.last_name,
  p.is_active as user_active,
  r.name as role_name,
  r.description as role_description,
  ur.is_active as role_active,
  ur.assigned_at,
  ur.expires_at,
  assigned_by.email as assigned_by_email
FROM public.profiles p
LEFT JOIN public.user_roles ur ON ur.user_id = p.id AND ur.is_active = true
LEFT JOIN public.roles r ON r.id = ur.role_id
LEFT JOIN public.profiles assigned_by ON assigned_by.id = ur.assigned_by
WHERE p.is_active = true
ORDER BY p.email, ur.assigned_at DESC;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_user_primary_role(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_primary_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_primary_role(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.invalidate_user_sessions(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_role_to_user(uuid, text, uuid) TO service_role;

GRANT SELECT ON public.user_roles_view TO authenticated;
GRANT SELECT ON public.user_roles_view TO service_role;

-- Update the handle_new_user function to use RBAC system properly
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role_uuid uuid;
BEGIN
    -- Insert profile without role column (we'll use RBAC system)
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email);
    
    -- Get admin role UUID and assign it (default to admin for new users)
    SELECT id INTO user_role_uuid FROM public.roles WHERE name = 'admin';
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, user_role_uuid);
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error and continue
        INSERT INTO public.function_logs (function_name, error_message, record_id)
        VALUES ('handle_new_user', SQLERRM, NEW.id);
        RETURN NEW;
END;
$$ LANGUAGE 'plpgsql' SECURITY DEFINER;

-- Create trigger for new user registration
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update RLS policies to use RBAC system instead of profiles.role
-- Drop existing policies that use profiles.role
DROP POLICY IF EXISTS "Super admins can manage roles" ON public.roles;
DROP POLICY IF EXISTS "Admins and users can view roles" ON public.roles;
DROP POLICY IF EXISTS "Super admins can manage permissions" ON public.permissions;
DROP POLICY IF EXISTS "Admins can view permissions" ON public.permissions;
DROP POLICY IF EXISTS "Super admins can manage role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Admins can view role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Super admins can manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage non-admin user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;

-- -- Create new RLS policies using RBAC system
-- CREATE POLICY "Super admins can manage roles" 
-- ON public.roles 
-- FOR ALL 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role = 'super_admin'
--   )
-- );

-- CREATE POLICY "Admins and users can view roles" 
-- ON public.roles 
-- FOR SELECT 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role IN ('admin', 'super_admin', 'user')
--   )
-- );

-- CREATE POLICY "Super admins can manage permissions" 
-- ON public.permissions 
-- FOR ALL 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role = 'super_admin'
--   )
-- );

-- CREATE POLICY "Admins can view permissions" 
-- ON public.permissions 
-- FOR SELECT 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role IN ('admin', 'super_admin')
--   )
-- );

-- CREATE POLICY "Super admins can manage role permissions" 
-- ON public.role_permissions 
-- FOR ALL 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role = 'super_admin'
--   )
-- );

-- CREATE POLICY "Admins can view role permissions" 
-- ON public.role_permissions 
-- FOR SELECT 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role IN ('admin', 'super_admin')
--   )
-- );

-- CREATE POLICY "Super admins can manage user roles" 
-- ON public.user_roles 
-- FOR ALL 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role = 'super_admin'
--   )
-- );

-- CREATE POLICY "Admins can manage non-super-admin user roles" 
-- ON public.user_roles 
-- FOR ALL 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS user_role
--     WHERE user_role = 'admin'
--   )
--   AND NOT EXISTS (
--     SELECT 1 FROM public.roles r
--     WHERE r.id = user_roles.role_id AND r.name = 'super_admin'
--   )
-- );

-- CREATE POLICY "Users can view their own roles" 
-- ON public.user_roles 
-- FOR SELECT 
-- USING (user_id = auth.uid());

-- -- Update profiles table RLS policies to use RBAC system
-- DROP POLICY IF EXISTS "Super admins can manage all profiles" ON public.profiles;
-- DROP POLICY IF EXISTS "Admins can view and update non-admin profiles" ON public.profiles;
-- DROP POLICY IF EXISTS "Admins can update non-super-admin profiles" ON public.profiles;
-- DROP POLICY IF EXISTS "Users can view and update their own profile" ON public.profiles;
-- DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
-- DROP POLICY IF EXISTS "Only admins can change user roles" ON public.profiles;

-- CREATE POLICY "Super admins can manage all profiles" 
-- ON public.profiles 
-- FOR ALL 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role = 'super_admin'
--   )
-- );

-- CREATE POLICY "Admins can view all profiles" 
-- ON public.profiles 
-- FOR SELECT 
-- USING (
--   id = auth.uid() OR
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role IN ('admin', 'super_admin')
--   )
-- );

-- CREATE POLICY "Admins can update profiles" 
-- ON public.profiles 
-- FOR UPDATE 
-- USING (
--   id = auth.uid() OR
--   EXISTS (
--     SELECT 1 FROM public.get_user_primary_role(auth.uid()) AS role
--     WHERE role IN ('admin', 'super_admin')
--   )
-- );

-- CREATE POLICY "Users can view and update their own profile" 
-- ON public.profiles 
-- FOR SELECT 
-- USING (id = auth.uid());

-- CREATE POLICY "Users can update their own profile" 
-- ON public.profiles 
-- FOR UPDATE 
-- USING (id = auth.uid())
-- WITH CHECK (id = auth.uid());

-- Grant additional permissions needed for RBAC functions
GRANT EXECUTE ON FUNCTION public.get_user_primary_role(uuid) TO supabase_auth_admin;
GRANT SELECT ON public.user_roles TO supabase_auth_admin;
GRANT SELECT ON public.roles TO supabase_auth_admin;

-- Add comments
COMMENT ON FUNCTION public.get_user_primary_role(uuid) IS 'Gets user primary role from RBAC system (user_roles table)';
COMMENT ON FUNCTION public.invalidate_user_sessions(uuid) IS 'Invalidates all sessions for a user to force token refresh';
COMMENT ON FUNCTION public.assign_role_to_user(uuid, text, uuid) IS 'Helper function to assign a role to a user through RBAC system';
COMMENT ON VIEW public.user_roles_view IS 'View showing user roles from RBAC system';
COMMENT ON FUNCTION public.handle_new_user() IS 'Updated to use RBAC system and assign admin role by default';
