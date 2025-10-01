-- Migration: Create plan_features table
-- Description: Store plan features as separate rows instead of JSONB for better flexibility and scalability

CREATE TABLE public.plan_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Ensure unique feature per plan
    CONSTRAINT plan_features_unique_feature_per_plan UNIQUE (plan_id, feature)
);

-- Create indexes for better performance
CREATE INDEX idx_plan_features_plan_id ON public.plan_features(plan_id);
CREATE INDEX idx_plan_features_position ON public.plan_features(plan_id, position);
CREATE INDEX idx_plan_features_feature ON public.plan_features(feature);

-- Grant permissions
GRANT SELECT ON TABLE public.plan_features TO anon;
GRANT SELECT ON TABLE public.plan_features TO authenticated;
GRANT ALL ON TABLE public.plan_features TO service_role;

-- Add comments for documentation
COMMENT ON TABLE public.plan_features IS 'Plan features stored as individual rows for display on pricing page';
COMMENT ON COLUMN public.plan_features.plan_id IS 'Reference to parent plan';
COMMENT ON COLUMN public.plan_features.feature IS 'Feature description text (e.g., "4 reports per month")';
COMMENT ON COLUMN public.plan_features.position IS 'Display order (lower numbers shown first)';