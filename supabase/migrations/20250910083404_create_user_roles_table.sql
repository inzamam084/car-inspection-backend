-- Create user_roles table to assign roles to users
-- This migration creates the table that assigns roles to users with expiration support

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

-- Create indexes for better performance
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON public.user_roles(role_id);
CREATE INDEX idx_user_roles_active ON public.user_roles(is_active);

-- Grant permissions to different roles
GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;

-- Add comments for documentation
COMMENT ON TABLE public.user_roles IS 'User role assignments with expiration support';
