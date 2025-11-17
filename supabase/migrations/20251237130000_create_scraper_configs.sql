-- Migration: Create scraper_configs table
-- Description: Stores scraper configuration metadata for supported domains

CREATE TABLE IF NOT EXISTS public.scraper_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    image_url TEXT,
    path_patterns JSONB,
    interactions JSONB,
    selectors JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Table and column documentation
COMMENT ON TABLE public.scraper_configs IS 'Stores scraper configuration metadata, selectors, and behavior per domain.';
COMMENT ON COLUMN public.scraper_configs.id IS 'Primary key generated with gen_random_uuid().';
COMMENT ON COLUMN public.scraper_configs.domain IS 'Unique domain (e.g., example.com) the scraper configuration applies to.';
COMMENT ON COLUMN public.scraper_configs.display_name IS 'Human-friendly label shown in dashboards or admin tools.';
COMMENT ON COLUMN public.scraper_configs.image_url IS 'Optional image/logo URL representing the domain or marketplace.';
COMMENT ON COLUMN public.scraper_configs.path_patterns IS 'JSON array describing URL path patterns (e.g., ["/vehicle/", "/lot/"]).';
COMMENT ON COLUMN public.scraper_configs.interactions IS 'JSON array capturing scripted interactions (selector, action, purpose, etc.).';
COMMENT ON COLUMN public.scraper_configs.selectors IS 'JSON object with data selectors and fallbacks (e.g., VIN, price, etc.).';
COMMENT ON COLUMN public.scraper_configs.metadata IS 'JSON object for quality metrics (confidence scores, validation results, etc.).';
COMMENT ON COLUMN public.scraper_configs.created_at IS 'Timestamp when the configuration was first created.';
COMMENT ON COLUMN public.scraper_configs.updated_at IS 'Timestamp automatically updated when the configuration changes.';
COMMENT ON COLUMN public.scraper_configs.created_by IS 'Identifier for who/what created the record (AI agent or user email).';
COMMENT ON COLUMN public.scraper_configs.version IS 'Manual version counter for tracking config evolution.';
COMMENT ON COLUMN public.scraper_configs.is_active IS 'Flag to enable/disable the configuration without deleting it.';

-- Grants
GRANT SELECT ON TABLE public.scraper_configs TO authenticated;
GRANT ALL ON TABLE public.scraper_configs TO service_role;

-- Enable RLS
ALTER TABLE public.scraper_configs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can read active scraper configs"
ON public.scraper_configs
FOR SELECT
USING (is_active);

CREATE POLICY "Service role can manage scraper configs"
ON public.scraper_configs
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
