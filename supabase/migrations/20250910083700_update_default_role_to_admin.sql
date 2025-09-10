-- Update Default Role to Admin
-- This migration changes the default role from 'user' to 'admin' for new user registrations

-- Update the default value for the role column in profiles table
ALTER TABLE public.profiles 
ALTER COLUMN role SET DEFAULT 'admin';

-- Update the handle_new_user function to assign admin role by default
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role_uuid uuid;
BEGIN
    -- Insert profile with default admin role
    INSERT INTO public.profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'admin');
    
    -- Get admin role UUID and assign it
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

-- Update existing users who have 'user' role to 'admin' role (optional - uncomment if needed)
-- WARNING: This will change ALL existing users with 'user' role to 'admin' role
-- Only uncomment if you want to upgrade existing users
/*
UPDATE public.profiles 
SET role = 'admin', updated_at = now()
WHERE role = 'user' AND is_active = true;

-- Update user_roles table to reflect the role change
UPDATE public.user_roles 
SET role_id = (SELECT id FROM public.roles WHERE name = 'admin'),
    assigned_at = now(),
    assigned_by = (SELECT id FROM public.profiles WHERE role = 'super_admin' LIMIT 1)
WHERE role_id = (SELECT id FROM public.roles WHERE name = 'user')
AND is_active = true;
*/

-- Add comment for documentation
COMMENT ON FUNCTION public.handle_new_user() IS 'Updated to assign admin role by default to new users';

-- Log the migration
INSERT INTO public.function_logs (function_name, error_message, record_id)
VALUES ('migration_20250910083700', 'Default role changed from user to admin', null);
