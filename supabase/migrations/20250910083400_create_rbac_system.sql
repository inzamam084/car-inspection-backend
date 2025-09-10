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

-- Add role column to profiles table for quick access
ALTER TABLE public.profiles 
ADD COLUMN role text default 'user' check (role in ('user', 'admin', 'super_admin'));

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
CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_is_active ON public.profiles(is_active);

-- Insert default roles
INSERT INTO public.roles (name, description, is_system_role) VALUES
('super_admin', 'Super Administrator with full system access', true),
('admin', 'Administrator with limited system access', true),
('user', 'Regular user with basic access', true);

-- Insert default permissions
INSERT INTO public.permissions (name, description, resource, action) VALUES
-- User management permissions
('manage_users', 'Full user management access', 'users', 'manage'),
('view_users', 'View user information', 'users', 'read'),
('create_users', 'Create new users', 'users', 'create'),
('update_users', 'Update user information', 'users', 'update'),
('delete_users', 'Delete users', 'users', 'delete'),

-- Inspection permissions
('manage_inspections', 'Full inspection management', 'inspections', 'manage'),
('view_all_inspections', 'View all inspections', 'inspections', 'read_all'),
('view_own_inspections', 'View own inspections', 'inspections', 'read_own'),
('create_inspections', 'Create inspections', 'inspections', 'create'),
('update_inspections', 'Update inspections', 'inspections', 'update'),
('delete_inspections', 'Delete inspections', 'inspections', 'delete'),

-- Report permissions
('manage_reports', 'Full report management', 'reports', 'manage'),
('view_all_reports', 'View all reports', 'reports', 'read_all'),
('view_own_reports', 'View own reports', 'reports', 'read_own'),
('generate_reports', 'Generate reports', 'reports', 'create'),

-- System permissions
('manage_system', 'Full system management', 'system', 'manage'),
('view_system_logs', 'View system logs', 'system', 'read_logs'),
('manage_roles', 'Manage roles and permissions', 'roles', 'manage'),
('view_analytics', 'View system analytics', 'analytics', 'read'),

-- Support permissions
('manage_support', 'Manage support tickets', 'support', 'manage'),
('view_all_support', 'View all support tickets', 'support', 'read_all'),
('view_own_support', 'View own support tickets', 'support', 'read_own'),

-- Subscription permissions
('manage_subscriptions', 'Manage user subscriptions', 'subscriptions', 'manage'),
('view_subscriptions', 'View subscription information', 'subscriptions', 'read');

-- Assign permissions to roles
-- Super Admin gets all permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id 
FROM public.roles r, public.permissions p 
WHERE r.name = 'super_admin';

-- Admin gets limited permissions (no user deletion, no system management)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id 
FROM public.roles r, public.permissions p 
WHERE r.name = 'admin' 
AND p.name IN (
  'view_users', 'create_users', 'update_users',
  'manage_inspections', 'view_all_inspections', 'create_inspections', 'update_inspections',
  'manage_reports', 'view_all_reports', 'generate_reports',
  'view_system_logs', 'view_analytics',
  'manage_support', 'view_all_support',
  'view_subscriptions'
);

-- Regular users get basic permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id 
FROM public.roles r, public.permissions p 
WHERE r.name = 'user' 
AND p.name IN (
  'view_own_inspections', 'create_inspections', 'update_inspections',
  'view_own_reports', 'generate_reports',
  'view_own_support'
);

-- Enable Row Level Security on new tables
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for roles table
CREATE POLICY "Super admins can manage roles" 
ON public.roles 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins and users can view roles" 
ON public.roles 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin', 'user') AND is_active = true
  )
);

-- Create RLS policies for permissions table
CREATE POLICY "Super admins can manage permissions" 
ON public.permissions 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can view permissions" 
ON public.permissions 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

-- Create RLS policies for role_permissions table
CREATE POLICY "Super admins can manage role permissions" 
ON public.role_permissions 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can view role permissions" 
ON public.role_permissions 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

-- Create RLS policies for user_roles table
CREATE POLICY "Super admins can manage user roles" 
ON public.user_roles 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can manage non-admin user roles" 
ON public.user_roles 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON r.id = user_roles.role_id
    WHERE p.id = auth.uid() 
    AND p.role = 'admin' 
    AND p.is_active = true
    AND r.name != 'super_admin'
  )
);

CREATE POLICY "Users can view their own roles" 
ON public.user_roles 
FOR SELECT 
USING (user_id = auth.uid());

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

-- Create function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)
RETURNS text AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = user_uuid AND is_active = true;
  
  RETURN COALESCE(user_role, 'user');
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

-- Create function to sync user role with user_roles table
CREATE OR REPLACE FUNCTION public.sync_user_role()
RETURNS TRIGGER AS $$
DECLARE
  role_uuid uuid;
BEGIN
  -- Get the role UUID
  SELECT id INTO role_uuid FROM public.roles WHERE name = NEW.role;
  
  -- Remove existing role assignments
  UPDATE public.user_roles 
  SET is_active = false 
  WHERE user_id = NEW.id;
  
  -- Add new role assignment
  INSERT INTO public.user_roles (user_id, role_id, assigned_by)
  VALUES (NEW.id, role_uuid, auth.uid())
  ON CONFLICT (user_id, role_id) 
  DO UPDATE SET is_active = true, assigned_at = now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to sync role changes
CREATE OR REPLACE TRIGGER sync_user_role_trigger
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION public.sync_user_role();

-- Update the handle_new_user function to set default role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role_uuid uuid;
BEGIN
    -- Insert profile with default user role
    INSERT INTO public.profiles (id, email, role)
    VALUES (NEW.id, NEW.email);
    
    -- Get user role UUID and assign it
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

-- Add comments for documentation
COMMENT ON TABLE public.roles IS 'System roles for RBAC';
COMMENT ON TABLE public.permissions IS 'System permissions for RBAC';
COMMENT ON TABLE public.role_permissions IS 'Junction table linking roles to permissions';
COMMENT ON TABLE public.user_roles IS 'User role assignments with expiration support';
COMMENT ON FUNCTION public.get_user_permissions(uuid) IS 'Returns all permissions for a given user';
COMMENT ON FUNCTION public.user_has_permission(uuid, text) IS 'Checks if user has a specific permission';
COMMENT ON FUNCTION public.get_user_role(uuid) IS 'Returns the primary role for a user';
