-- Create authentication triggers and functions
-- This migration creates triggers for handling user authentication and login tracking

-- Create function to update user last login
CREATE OR REPLACE FUNCTION public.update_user_last_login()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles 
  SET last_login_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to update last login on auth
CREATE OR REPLACE TRIGGER on_auth_user_login
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION public.update_user_last_login();

-- Update the handle_new_user function to use RBAC system only
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role_uuid uuid;
BEGIN
    -- Insert profile without role column (using RBAC system only)
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email);
    
    -- Get admin role UUID and assign it through RBAC system
    SELECT id INTO user_role_uuid FROM public.roles WHERE name = 'admin';
    
    -- Only insert if role exists
    IF user_role_uuid IS NOT NULL THEN
        INSERT INTO public.user_roles (user_id, role_id)
        VALUES (NEW.id, user_role_uuid);
    END IF;
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error and continue, but still create the profile
        BEGIN
            INSERT INTO public.profiles (id, email)
            VALUES (NEW.id, NEW.email)
            ON CONFLICT (id) DO NOTHING;
            
            -- Try to assign default role even if profile creation had issues
            SELECT id INTO user_role_uuid FROM public.roles WHERE name = 'admin';
            IF user_role_uuid IS NOT NULL THEN
                INSERT INTO public.user_roles (user_id, role_id)
                VALUES (NEW.id, user_role_uuid)
                ON CONFLICT (user_id, role_id) DO NOTHING;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                -- If even basic profile creation fails, log it
                INSERT INTO public.function_logs (function_name, error_message, record_id)
                VALUES ('handle_new_user', CONCAT('Profile creation failed: ', SQLERRM), NEW.id);
        END;
        RETURN NEW;
END;
$$ LANGUAGE 'plpgsql' SECURITY DEFINER;

-- Create trigger for new user registration
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
