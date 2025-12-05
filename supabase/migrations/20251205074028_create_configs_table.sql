-- Migration: Create unified configs table
-- Description: Unified configuration storage for both listings page filters and detail page scraping
-- Architecture: Option B (Single JSONB Config Column)

-- Create the configs table
CREATE TABLE IF NOT EXISTS configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR NOT NULL,
  display_name VARCHAR,
  image_url TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  CONSTRAINT unique_domain_version UNIQUE(domain, version)
);

-- Add comment to table
COMMENT ON TABLE configs IS 'Unified configuration for website scraping - contains both listings page filters and detail page scraping configs';

-- Add comments to columns
COMMENT ON COLUMN configs.domain IS 'Base domain of the website (e.g., craigslist.org)';
COMMENT ON COLUMN configs.display_name IS 'Human-readable name for the website';
COMMENT ON COLUMN configs.image_url IS 'Optional logo/icon URL for the website';
COMMENT ON COLUMN configs.config IS 'JSONB object containing listingsPage and detailPage configurations';
COMMENT ON COLUMN configs.version IS 'Config version number - allows versioning of configurations';
COMMENT ON COLUMN configs.is_active IS 'Whether this config version is currently active';

-- Create indexes for performance
CREATE INDEX idx_configs_domain ON configs(domain);
CREATE INDEX idx_configs_active ON configs(is_active) WHERE is_active = true;
CREATE INDEX idx_configs_domain_active ON configs(domain, is_active) WHERE is_active = true;

-- Create GIN indexes for JSONB path pattern searches
CREATE INDEX idx_configs_listings_paths ON configs 
  USING GIN ((config->'listingsPage'->'pathPatterns')) 
  WHERE config->'listingsPage' IS NOT NULL;

CREATE INDEX idx_configs_detail_paths ON configs 
  USING GIN ((config->'detailPage'->'pathPatterns')) 
  WHERE config->'detailPage' IS NOT NULL;

-- Create function to auto-update updated_at column
CREATE OR REPLACE FUNCTION update_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating updated_at
CREATE TRIGGER update_configs_updated_at_trigger
  BEFORE UPDATE ON configs
  FOR EACH ROW
  EXECUTE FUNCTION update_configs_updated_at();

-- -- Add constraint to ensure config has at least one flow
-- CREATE OR REPLACE FUNCTION validate_config_has_flow()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF (NEW.config->'listingsPage' IS NULL AND NEW.config->'detailPage' IS NULL) THEN
--     RAISE EXCEPTION 'Config must contain at least one flow (listingsPage or detailPage)';
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE TRIGGER validate_config_has_flow_trigger
--   BEFORE INSERT OR UPDATE ON configs
--   FOR EACH ROW
--   EXECUTE FUNCTION validate_config_has_flow();

-- -- Create function to deactivate old versions when inserting a new active version
-- CREATE OR REPLACE FUNCTION deactivate_old_config_versions()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF NEW.is_active = TRUE THEN
--     UPDATE configs 
--     SET is_active = FALSE 
--     WHERE domain = NEW.domain 
--       AND id != NEW.id 
--       AND is_active = TRUE;
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE TRIGGER deactivate_old_config_versions_trigger
--   BEFORE INSERT OR UPDATE ON configs
--   FOR EACH ROW
--   WHEN (NEW.is_active = TRUE)
--   EXECUTE FUNCTION deactivate_old_config_versions();

-- -- Insert example config for reference (can be removed in production)
-- INSERT INTO configs (
--   domain,
--   display_name,
--   image_url,
--   config,
--   version,
--   is_active,
--   created_by
-- ) VALUES (
--   'example.com',
--   'Example Website',
--   'https://example.com/logo.png',
--   '{
--     "listingsPage": {
--       "pathPatterns": ["/search", "/listings"],
--       "filters": {
--         "minPrice": {
--           "label": "Min Price",
--           "selector": "input[name=\"min_price\"]",
--           "action": "input",
--           "type": "number"
--         },
--         "maxPrice": {
--           "label": "Max Price",
--           "selector": "input[name=\"max_price\"]",
--           "action": "input",
--           "type": "number"
--         }
--       },
--       "resetButton": {
--         "selector": "button.reset-filters",
--         "waitAfterClick": 1000
--       },
--       "searchButton": {
--         "selector": "button.apply-filters",
--         "waitAfterClick": 2000
--       },
--       "results": {
--         "containerSelector": "div.results",
--         "itemSelector": "div.result-item",
--         "fields": {
--           "title": {
--             "selector": "h3.title"
--           },
--           "price": {
--             "selector": "span.price"
--           },
--           "link": {
--             "selector": "a.item-link",
--             "attribute": "href"
--           }
--         }
--       }
--     },
--     "detailPage": {
--       "pathPatterns": ["/item/", "/vehicle/"],
--       "interactions": [
--         {
--           "selector": "button.next-image",
--           "action": "click",
--           "purpose": "Navigate image carousel",
--           "maxClicks": 10,
--           "waitBetweenClicks": 500
--         }
--       ],
--       "selectors": {
--         "vin": {
--           "primary": ["span.vin-number"],
--           "fallback": ["div.vehicle-info"]
--         },
--         "mileage": {
--           "primary": ["span.mileage"],
--           "fallback": ["div.stats .mileage"]
--         },
--         "condition": {
--           "primary": ["span.condition"]
--         }
--       },
--       "metadata": {
--         "confidence": 0.95,
--         "lastValidated": "2025-12-05T00:00:00Z"
--       }
--     },
--     "shared": {
--       "waitDefaults": {
--         "input": 500,
--         "click": 300,
--         "navigation": 2000
--       },
--       "retryPolicy": {
--         "maxRetries": 3,
--         "retryDelay": 1000
--       }
--     }
--   }'::jsonb,
--   1,
--   true,
--   'migration_script'
-- ) ON CONFLICT (domain, version) DO NOTHING;
