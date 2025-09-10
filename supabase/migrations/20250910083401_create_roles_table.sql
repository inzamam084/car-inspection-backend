-- Create roles table for RBAC system
-- This migration creates the core roles table

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

-- Create indexes for better performance
CREATE INDEX idx_roles_name ON public.roles(name);

-- Grant permissions to different roles
GRANT ALL ON TABLE public.roles TO anon;
GRANT ALL ON TABLE public.roles TO authenticated;
GRANT ALL ON TABLE public.roles TO service_role;

-- Add comments for documentation
COMMENT ON TABLE public.roles IS 'System roles for RBAC';
