-- Migration: Drop billing_history table
-- Description: Remove redundant billing_history table as it's replaced by the payments table
-- The payments table (created in 20251001120700) provides more comprehensive payment tracking

-- Drop the billing_history table
-- This will cascade delete any foreign key references if they exist
DROP TABLE IF EXISTS public.billing_history CASCADE;

-- Add comment for documentation
COMMENT ON SCHEMA public IS 'Dropped billing_history table on 2025-10-02 - replaced by payments table for comprehensive payment tracking';
