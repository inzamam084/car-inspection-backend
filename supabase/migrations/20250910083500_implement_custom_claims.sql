-- Implement Custom Claims for Supabase Auth
-- This migration implements custom claims according to Supabase documentation
-- Custom claims are added to the JWT token for client-side role checking

-- Create function to get custom claims for a user
CREATE OR REPLACE FUNCTION public.get_custom_claims(user_uuid uuid)
RETURNS jsonb AS $$
DECLARE
  user_profile record;
  user_permissions text[];
  claims jsonb;
BEGIN
  -- Get user profile information
  SELECT role, is_active, first_name, last_name
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

  -- Get user permissions
  SELECT array_agg(permission_name)
  INTO user_permissions
  FROM public.get_user_permissions(user_uuid);

  -- Build custom claims object
  claims := jsonb_build_object(
    'role', COALESCE(user_profile.role, 'user'),
    'permissions', COALESCE(to_jsonb(user_permissions), '[]'::jsonb),
    'is_active', COALESCE(user_profile.is_active, true),
    'full_name', CONCAT(COALESCE(user_profile.first_name, ''), ' ', COALESCE(user_profile.last_name, '')),
    'dashboard_type', CASE 
      WHEN user_profile.role = 'super_admin' THEN 'super_admin'
      WHEN user_profile.role = 'admin' THEN 'admin'
      ELSE 'user'
    END
  );

  RETURN claims;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to handle custom claims in JWT
-- This function will be called by Supabase Auth to add custom claims to JWT tokens
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  claims jsonb;
  user_id uuid;
BEGIN
  -- Extract user ID from the event
  user_id := (event->>'user_id')::uuid;
  
  -- Get custom claims for the user
  claims := public.get_custom_claims(user_id);
  
  -- Add custom claims to the JWT token
  event := jsonb_set(event, '{claims}', claims);
  
  RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions on the custom claims functions
GRANT EXECUTE ON FUNCTION public.get_custom_claims(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_custom_claims(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_custom_claims(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO service_role;

-- Create function to refresh user claims (useful for role changes)
CREATE OR REPLACE FUNCTION public.refresh_user_claims(user_uuid uuid)
RETURNS jsonb AS $$
DECLARE
  claims jsonb;
BEGIN
  -- Get fresh claims
  claims := public.get_custom_claims(user_uuid);
  
  -- You can add additional logic here to invalidate existing tokens if needed
  -- For now, we just return the fresh claims
  
  RETURN claims;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check if user has specific role
CREATE OR REPLACE FUNCTION public.user_has_role(user_uuid uuid, required_role text)
RETURNS boolean AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = user_uuid AND is_active = true;
  
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

-- Create function to get dashboard redirect URL based on role
CREATE OR REPLACE FUNCTION public.get_dashboard_url(user_uuid uuid)
RETURNS text AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = user_uuid AND is_active = true;
  
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

-- Update the handle_new_user function to work with custom claims
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role_uuid uuid;
BEGIN
    -- Insert profile with default user role
    INSERT INTO public.profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'user');
    
    -- Get user role UUID and assign it
    SELECT id INTO user_role_uuid FROM public.roles WHERE name = 'user';
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

-- Create trigger to refresh claims when user role changes
CREATE OR REPLACE FUNCTION public.refresh_claims_on_role_change()
RETURNS TRIGGER AS $$
BEGIN
  -- This function can be extended to invalidate existing JWT tokens
  -- For now, it just ensures the role change is logged
  INSERT INTO public.function_logs (function_name, error_message, record_id)
  VALUES ('role_changed', CONCAT('Role changed from ', OLD.role, ' to ', NEW.role), NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for role changes
CREATE OR REPLACE TRIGGER refresh_claims_on_role_change_trigger
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION public.refresh_claims_on_role_change();

-- Grant execute permissions on utility functions
GRANT EXECUTE ON FUNCTION public.refresh_user_claims(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_claims(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.user_has_role(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.user_has_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_role(uuid, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_dashboard_url(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_url(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_url(uuid) TO service_role;

-- Add comments for documentation
COMMENT ON FUNCTION public.get_custom_claims(uuid) IS 'Returns custom claims for JWT token including role and permissions';
COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS 'Hook function for Supabase Auth to add custom claims to JWT tokens';
COMMENT ON FUNCTION public.refresh_user_claims(uuid) IS 'Refreshes user claims after role/permission changes';
COMMENT ON FUNCTION public.user_has_role(uuid, text) IS 'Checks if user has specific role with hierarchy support';
COMMENT ON FUNCTION public.get_dashboard_url(uuid) IS 'Returns appropriate dashboard URL based on user role';
