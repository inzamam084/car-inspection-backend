-- Environment Configuration Setup for Supabase Branches
-- Run these commands in each environment to configure environment-specific credentials

-- =============================================================================
-- PRODUCTION ENVIRONMENT SETUP
-- =============================================================================
-- Replace 'your-production-project-ref' with your actual production project reference
-- Replace 'your-production-anon-key' with your actual production anon key

-- Example for production:
-- ALTER DATABASE postgres SET app.project_ref = 'hhymqgsreoqpoqdpefhe';
-- ALTER DATABASE postgres SET app.supabase_anon_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoeW1xZ3NyZW9xcG9xZHBlZmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY2ODU1MTIsImV4cCI6MjA2MjI2MTUxMn0.pcS49IJ2bLuyH_J1rkrf-0vRoCCycN0BhOdnnzlUOUw';

-- =============================================================================
-- STAGING/DEVELOPMENT ENVIRONMENT SETUP
-- =============================================================================
-- Replace 'your-staging-project-ref' with your actual staging project reference
-- Replace 'your-staging-anon-key' with your actual staging anon key

-- Example for staging:
-- ALTER DATABASE postgres SET app.project_ref = 'your-staging-project-ref';
-- ALTER DATABASE postgres SET app.supabase_anon_key = 'your-staging-anon-key';

-- =============================================================================
-- HOW TO GET YOUR PROJECT REFERENCE AND ANON KEY
-- =============================================================================

-- 1. PROJECT REFERENCE:
--    - Go to your Supabase dashboard
--    - The project reference is in your project URL: https://[PROJECT_REF].supabase.co
--    - Or find it in Settings > General > Reference ID

-- 2. ANON KEY:
--    - Go to your Supabase dashboard
--    - Navigate to Settings > API
--    - Copy the "anon public" key

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
-- Run these to verify your configuration is working:

-- Check current settings:
-- SELECT current_setting('app.project_ref', true) as project_ref;
-- SELECT current_setting('app.supabase_anon_key', true) as anon_key;

-- Test the helper functions:
-- SELECT get_supabase_url() as dynamic_url;
-- SELECT get_supabase_anon_key() as dynamic_anon_key;

-- =============================================================================
-- ALTERNATIVE: MANUAL URL OVERRIDE
-- =============================================================================
-- If you're using custom domains or need to override the URL construction:
-- ALTER DATABASE postgres SET app.supabase_url = 'https://your-custom-domain.com';

-- =============================================================================
-- REMOVING CONFIGURATION (if needed)
-- =============================================================================
-- To remove the settings:
-- ALTER DATABASE postgres RESET app.project_ref;
-- ALTER DATABASE postgres RESET app.supabase_anon_key;
-- ALTER DATABASE postgres RESET app.supabase_url;
