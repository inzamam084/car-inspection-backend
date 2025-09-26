-- Update subscription plan_id constraint to include starter_plan and pro_plan
-- This migration adds new plan types while maintaining backward compatibility

-- First, drop the existing constraint
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_id_check;

-- Add the new constraint with all plan types including the new ones
ALTER TABLE subscriptions 
ADD CONSTRAINT subscriptions_plan_id_check 
CHECK (plan_id IN ('basic', 'starter', 'pro', 'elite', 'enterprise', 'starter_plan', 'pro_plan', 'elite_plan'));

-- Optional: Update any existing 'basic' plans to 'starter_plan' if needed (uncomment if required)
-- UPDATE subscriptions SET plan_id = 'starter_plan' WHERE plan_id = 'basic';

-- Optional: Update any existing 'pro' plans to 'pro_plan' if needed (uncomment if required)  
-- UPDATE subscriptions SET plan_id = 'pro_plan' WHERE plan_id = 'pro';
