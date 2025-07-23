-- Update subscription plan constraint to use starter, pro, and elite
-- Drop the existing constraint
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_id_check;

-- Add the new constraint with updated plan values
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_id_check 
    CHECK (plan_id IN ('starter', 'pro', 'elite'));
