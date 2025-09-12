-- Add additional profile fields for admin management
-- This migration adds RBAC-related fields to the profiles table

-- Add additional profile fields for admin management
ALTER TABLE public.profiles
ADD COLUMN is_active boolean not null default true,
ADD COLUMN last_login_at timestamp with time zone,
ADD COLUMN created_by uuid references public.profiles(id),
ADD COLUMN updated_at timestamp with time zone default now();

-- Create indexes for better performance
CREATE INDEX idx_profiles_is_active ON public.profiles(is_active);
