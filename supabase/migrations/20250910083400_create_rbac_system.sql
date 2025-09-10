-- Create RBAC System with Roles, Permissions, and Custom Claims
-- This migration creates a complete Role-Based Access Control system

-- Create roles table
CREATE TABLE public.roles (
  id uuid not null default gen_random_uuid(),
  name text not null unique,
  description text,
  is_system_role boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  
  primary key (id)
);

-- Create permissions table
CREATE TABLE public.permissions (
  id uuid not null default gen_random_uuid(),
  name text not null unique,
  description text,
  resource text not null, -- e.g., 'inspections', 'users', 'reports'
  action text not null, -- e.g., 'create', 'read', 'update', 'delete', 'manage'
  created_at timestamp with time zone not null default now(),
  
  primary key (id)
);

-- Create role_permissions junction table
CREATE TABLE public.role_permissions (
  id uuid not null default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  
  primary key (id),
  unique(role_id, permission_id)
);

-- Create user_roles table to assign roles to users
CREATE TABLE public.user_roles (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone,
  is_active boolean not null default true,
  
  primary key (id),
  unique(user_id, role_id)
);

-- Add additional profile fields for admin management
ALTER TABLE public.profiles 
ADD COLUMN is_active boolean not null default true,
ADD COLUMN last_login_at timestamp with time zone,
ADD COLUMN created_by uuid references public.profiles(id),
ADD COLUMN updated_at timestamp with time zone default now();

-- Create indexes for better performance
CREATE INDEX idx_roles_name ON public.roles(name);
CREATE INDEX idx_permissions_resource_action ON public.permissions(resource, action);
CREATE INDEX idx_role_permissions_role_id ON public.role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON public.role_permissions(permission_id);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON public.user_roles(role_id);
CREATE INDEX idx_user_roles_active ON public.user_roles(is_active);
CREATE INDEX idx_profiles_is_active ON public.profiles(is_active);

-- -- Enable Row Level Security on new tables
-- ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- -- RLS policies will be created in a separate migration to use proper RBAC functions
-- -- For now, disable RLS to allow the system to work
-- ALTER TABLE public.roles DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.permissions DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.role_permissions DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.user_roles DISABLE ROW LEVEL SECURITY;

-- Grant permissions to different roles
GRANT ALL ON TABLE public.roles TO anon;
GRANT ALL ON TABLE public.roles TO authenticated;
GRANT ALL ON TABLE public.roles TO service_role;

GRANT ALL ON TABLE public.permissions TO anon;
GRANT ALL ON TABLE public.permissions TO authenticated;
GRANT ALL ON TABLE public.permissions TO service_role;

GRANT ALL ON TABLE public.role_permissions TO anon;
GRANT ALL ON TABLE public.role_permissions TO authenticated;
GRANT ALL ON TABLE public.role_permissions TO service_role;

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;

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

-- Add comments for documentation
COMMENT ON TABLE public.roles IS 'System roles for RBAC';
COMMENT ON TABLE public.permissions IS 'System permissions for RBAC';
COMMENT ON TABLE public.role_permissions IS 'Junction table linking roles to permissions';
COMMENT ON TABLE public.user_roles IS 'User role assignments with expiration support';
COMMENT ON FUNCTION public.get_user_permissions(uuid) IS 'Returns all permissions for a given user';
COMMENT ON FUNCTION public.user_has_permission(uuid, text) IS 'Checks if user has a specific permission';
COMMENT ON FUNCTION public.get_user_role(uuid) IS 'Returns the primary role for a user';
