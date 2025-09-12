-- Create permissions table for RBAC system
-- This migration creates the permissions table for granular access control

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

-- Create indexes for better performance
CREATE INDEX idx_permissions_resource_action ON public.permissions(resource, action);

-- Grant permissions to different roles
GRANT ALL ON TABLE public.permissions TO anon;
GRANT ALL ON TABLE public.permissions TO authenticated;
GRANT ALL ON TABLE public.permissions TO service_role;

-- Add comments for documentation
COMMENT ON TABLE public.permissions IS 'System permissions for RBAC';
