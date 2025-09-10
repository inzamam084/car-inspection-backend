-- Update RLS Policies for RBAC System
-- This migration updates all existing RLS policies to work with the new role-based access control

-- Drop existing policies that conflict with RBAC
DROP POLICY IF EXISTS "Allow anonymous insert" ON public.inspections;
DROP POLICY IF EXISTS "Allow users to view their own inspections" ON public.inspections;
DROP POLICY IF EXISTS "Users can insert their own inspections" ON public.inspections;
DROP POLICY IF EXISTS "Users can update their own inspections" ON public.inspections;
DROP POLICY IF EXISTS "Users can view their own inspections" ON public.inspections;

DROP POLICY IF EXISTS "Allow anonymous insert" ON public.photos;
DROP POLICY IF EXISTS "Allow users to view photos for their inspections" ON public.photos;
DROP POLICY IF EXISTS "Users can insert photos for their inspections" ON public.photos;
DROP POLICY IF EXISTS "Users can view photos of their inspections" ON public.photos;

DROP POLICY IF EXISTS "Users can view reports of their inspections" ON public.reports;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow service role full access" ON public.profiles;

DROP POLICY IF EXISTS "Users can view own support requests" ON public.support;
DROP POLICY IF EXISTS "Users can create own support requests" ON public.support;
DROP POLICY IF EXISTS "Users can update own support requests" ON public.support;
DROP POLICY IF EXISTS "Allow service role full access" ON public.support;

-- Create new RBAC-based policies for inspections table
CREATE POLICY "Super admins can manage all inspections" 
ON public.inspections 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can manage all inspections" 
ON public.inspections 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

CREATE POLICY "Users can view their own inspections" 
ON public.inspections 
FOR SELECT 
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

CREATE POLICY "Users can create inspections" 
ON public.inspections 
FOR INSERT 
WITH CHECK (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

CREATE POLICY "Users can update their own inspections" 
ON public.inspections 
FOR UPDATE 
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

CREATE POLICY "Admins can delete inspections" 
ON public.inspections 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

-- Allow anonymous inserts for public forms
CREATE POLICY "Allow anonymous inspection creation" 
ON public.inspections 
FOR INSERT 
WITH CHECK (auth.uid() IS NULL);

-- Create new RBAC-based policies for photos table
CREATE POLICY "Super admins can manage all photos" 
ON public.photos 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can manage all photos" 
ON public.photos 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

CREATE POLICY "Users can view photos of their inspections" 
ON public.photos 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.inspections 
    WHERE inspections.id = photos.inspection_id 
    AND (
      inspections.user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
      )
    )
  )
);

CREATE POLICY "Users can insert photos for their inspections" 
ON public.photos 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.inspections 
    WHERE inspections.id = photos.inspection_id 
    AND (
      inspections.user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
      )
    )
  )
);

-- Allow anonymous photo uploads for public forms
CREATE POLICY "Allow anonymous photo uploads" 
ON public.photos 
FOR INSERT 
WITH CHECK (auth.uid() IS NULL);

-- Create new RBAC-based policies for reports table
CREATE POLICY "Super admins can manage all reports" 
ON public.reports 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can manage all reports" 
ON public.reports 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

CREATE POLICY "Users can view reports of their inspections" 
ON public.reports 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.inspections 
    WHERE inspections.id = reports.inspection_id 
    AND (
      inspections.user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
      )
    )
  )
);

-- Create new RBAC-based policies for obd2_codes table
CREATE POLICY "Super admins can manage all obd2 codes" 
ON public.obd2_codes 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can manage all obd2 codes" 
ON public.obd2_codes 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

CREATE POLICY "Users can view obd2 codes of their inspections" 
ON public.obd2_codes 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.inspections 
    WHERE inspections.id = obd2_codes.inspection_id 
    AND (
      inspections.user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
      )
    )
  )
);

-- Create new RBAC-based policies for title_images table
CREATE POLICY "Super admins can manage all title images" 
ON public.title_images 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can manage all title images" 
ON public.title_images 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

CREATE POLICY "Users can view title images of their inspections" 
ON public.title_images 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.inspections 
    WHERE inspections.id = title_images.inspection_id 
    AND (
      inspections.user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
      )
    )
  )
);

-- Create new RBAC-based policies for profiles table
CREATE POLICY "Super admins can manage all profiles" 
ON public.profiles 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin' AND p.is_active = true
  )
);

CREATE POLICY "Admins can view and update non-admin profiles" 
ON public.profiles 
FOR SELECT 
USING (
  id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() 
    AND p.role IN ('admin', 'super_admin') 
    AND p.is_active = true
  )
);

CREATE POLICY "Admins can update non-super-admin profiles" 
ON public.profiles 
FOR UPDATE 
USING (
  id = auth.uid() OR
  (
    role != 'super_admin' AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() 
      AND p.role IN ('admin', 'super_admin') 
      AND p.is_active = true
    )
  )
);

CREATE POLICY "Users can view and update their own profile" 
ON public.profiles 
FOR SELECT 
USING (id = auth.uid());

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid() AND
  -- Users cannot change their own role
  (OLD.role = NEW.role OR 
   EXISTS (
     SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() 
     AND p.role IN ('admin', 'super_admin') 
     AND p.is_active = true
   )
  )
);

-- Create new RBAC-based policies for support table
CREATE POLICY "Super admins can manage all support tickets" 
ON public.support 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can manage all support tickets" 
ON public.support 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  )
);

CREATE POLICY "Users can view their own support tickets" 
ON public.support 
FOR SELECT 
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

CREATE POLICY "Users can create their own support tickets" 
ON public.support 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own support tickets" 
ON public.support 
FOR UPDATE 
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
)
WITH CHECK (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

-- Create RBAC-based policies for subscriptions table (if it exists)
CREATE POLICY "Super admins can manage all subscriptions" 
ON public.subscriptions 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can view all subscriptions" 
ON public.subscriptions 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

CREATE POLICY "Users can view their own subscription" 
ON public.subscriptions 
FOR SELECT 
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

-- Create RBAC-based policies for billing_history table (if it exists)
CREATE POLICY "Super admins can manage all billing history" 
ON public.billing_history 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  )
);

CREATE POLICY "Admins can view all billing history" 
ON public.billing_history 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active = true
  )
);

CREATE POLICY "Users can view their own billing history" 
ON public.billing_history 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.subscriptions s
    JOIN public.profiles p ON p.id = s.user_id
    WHERE s.id = billing_history.subscription_id 
    AND (
      p.id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.profiles admin
        WHERE admin.id = auth.uid() 
        AND admin.role IN ('admin', 'super_admin') 
        AND admin.is_active = true
      )
    )
  )
);

-- Service role policies for all tables
CREATE POLICY "Service role full access to inspections" 
ON public.inspections 
FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to photos" 
ON public.photos 
FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to reports" 
ON public.reports 
FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to obd2_codes" 
ON public.obd2_codes 
FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to title_images" 
ON public.title_images 
FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to profiles" 
ON public.profiles 
FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to support" 
ON public.support 
FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to subscriptions" 
ON public.subscriptions 
FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to billing_history" 
ON public.billing_history 
FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

-- Create helper function to check table permissions
CREATE OR REPLACE FUNCTION public.check_table_permission(
  table_name text,
  operation text,
  user_uuid uuid DEFAULT auth.uid()
)
RETURNS boolean AS $$
DECLARE
  user_role text;
  has_permission boolean := false;
BEGIN
  -- Get user role
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = user_uuid AND is_active = true;
  
  -- Super admin has all permissions
  IF user_role = 'super_admin' THEN
    RETURN true;
  END IF;
  
  -- Check specific permissions based on table and operation
  CASE table_name
    WHEN 'inspections' THEN
      CASE operation
        WHEN 'read_all' THEN
          has_permission := user_role IN ('admin', 'super_admin');
        WHEN 'manage' THEN
          has_permission := user_role IN ('admin', 'super_admin');
        ELSE
          has_permission := true; -- Basic operations allowed for all users
      END CASE;
    WHEN 'users' THEN
      CASE operation
        WHEN 'manage', 'delete' THEN
          has_permission := user_role = 'super_admin';
        WHEN 'view', 'create', 'update' THEN
          has_permission := user_role IN ('admin', 'super_admin');
        ELSE
          has_permission := false;
      END CASE;
    WHEN 'support' THEN
      CASE operation
        WHEN 'manage' THEN
          has_permission := user_role IN ('admin', 'super_admin');
        ELSE
          has_permission := true;
      END CASE;
    ELSE
      has_permission := false;
  END CASE;
  
  RETURN has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on helper function
GRANT EXECUTE ON FUNCTION public.check_table_permission(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_permission(text, text, uuid) TO service_role;

-- Add comments for documentation
COMMENT ON FUNCTION public.check_table_permission(text, text, uuid) IS 'Helper function to check if user has permission for specific table operations';
