-- Create role_permissions junction table
-- This migration creates the junction table that links roles to permissions

-- Create role_permissions junction table
CREATE TABLE public.role_permissions (
  id uuid not null default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  
  primary key (id),
  unique(role_id, permission_id)
);

-- Create indexes for better performance
CREATE INDEX idx_role_permissions_role_id ON public.role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON public.role_permissions(permission_id);

-- Grant permissions to different roles
GRANT ALL ON TABLE public.role_permissions TO anon;
GRANT ALL ON TABLE public.role_permissions TO authenticated;
GRANT ALL ON TABLE public.role_permissions TO service_role;

-- Add comments for documentation
COMMENT ON TABLE public.role_permissions IS 'Junction table linking roles to permissions';
