-- Migration: Create user search queries table
-- Description: Store user search queries with AI-generated filters and rankings

-- Create the user_search_queries table
CREATE TABLE IF NOT EXISTS public.user_search_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- User's natural language search query
  search_query TEXT NOT NULL,
  
  -- Platform/domain they're searching on
  platform_name VARCHAR NOT NULL,
  platform_domain VARCHAR,
  
  -- AI-generated filters based on the search query
  generated_filters JSONB DEFAULT '{}',
  
  -- Scraped listings data (raw results from the platform)
  scraped_listings JSONB DEFAULT '[]',
  
  -- AI-ranked listings with scores and reasoning
  ranked_listings JSONB DEFAULT '[]',
  
  -- AI analysis and ranking metadata
  ai_metadata JSONB DEFAULT '{}', -- Can include: confidence_score, reasoning, model_version, etc.
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Search session tracking
  session_id UUID, -- Optional: group related searches together
  
  -- Status tracking
  status VARCHAR DEFAULT 'pending', -- pending, filters_generated, listings_scraped, ranked, failed
  error_message TEXT,
  
  -- Performance metrics
  filter_generation_time_ms INTEGER,
  scraping_time_ms INTEGER,
  ranking_time_ms INTEGER,
  
  -- User feedback (optional)
  user_rating INTEGER, -- 1-5 stars
  user_feedback TEXT
);

-- Add comments to table
COMMENT ON TABLE public.user_search_queries IS 'Stores user search queries with AI-generated filters and rankings for vehicle listings';

-- Add comments to columns
COMMENT ON COLUMN public.user_search_queries.search_query IS 'User''s natural language description of what they''re looking for';
COMMENT ON COLUMN public.user_search_queries.generated_filters IS 'JSONB object containing AI-generated filters for the search platform';
COMMENT ON COLUMN public.user_search_queries.scraped_listings IS 'Array of raw listings data scraped from the platform';
COMMENT ON COLUMN public.user_search_queries.ranked_listings IS 'Array of listings ranked by AI with scores and reasoning';
COMMENT ON COLUMN public.user_search_queries.ai_metadata IS 'Additional AI analysis metadata (confidence, model version, etc.)';
COMMENT ON COLUMN public.user_search_queries.status IS 'Current status: pending, filters_generated, listings_scraped, ranked, failed';

-- Create indexes for performance
CREATE INDEX idx_user_search_queries_user_id ON public.user_search_queries(user_id);
CREATE INDEX idx_user_search_queries_created_at ON public.user_search_queries(created_at DESC);
CREATE INDEX idx_user_search_queries_status ON public.user_search_queries(status);
CREATE INDEX idx_user_search_queries_session_id ON public.user_search_queries(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_user_search_queries_platform ON public.user_search_queries(platform_name, platform_domain);

-- Create GIN indexes for JSONB searches
CREATE INDEX idx_user_search_queries_generated_filters ON public.user_search_queries USING GIN (generated_filters);
CREATE INDEX idx_user_search_queries_ranked_listings ON public.user_search_queries USING GIN (ranked_listings);

-- Create function to auto-update updated_at column
CREATE OR REPLACE FUNCTION update_user_search_queries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating updated_at
CREATE TRIGGER update_user_search_queries_updated_at_trigger
  BEFORE UPDATE ON public.user_search_queries
  FOR EACH ROW
  EXECUTE FUNCTION update_user_search_queries_updated_at();

-- Enable Row Level Security
ALTER TABLE public.user_search_queries ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view their own search queries
CREATE POLICY "Users can view own search queries"
ON public.user_search_queries
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own search queries
CREATE POLICY "Users can insert own search queries"
ON public.user_search_queries
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own search queries
CREATE POLICY "Users can update own search queries"
ON public.user_search_queries
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own search queries
CREATE POLICY "Users can delete own search queries"
ON public.user_search_queries
FOR DELETE
USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access to search queries"
ON public.user_search_queries
FOR ALL
USING (true);

-- Grant permissions
GRANT ALL ON TABLE public.user_search_queries TO authenticated;
GRANT SELECT ON TABLE public.user_search_queries TO anon;
GRANT ALL ON TABLE public.user_search_queries TO service_role;

-- -- Create a view for user search history with aggregated stats
-- CREATE OR REPLACE VIEW public.user_search_history AS
-- SELECT 
--   user_id,
--   COUNT(*) as total_searches,
--   COUNT(*) FILTER (WHERE status = 'ranked') as successful_searches,
--   COUNT(*) FILTER (WHERE status = 'failed') as failed_searches,
--   AVG(filter_generation_time_ms) as avg_filter_generation_time_ms,
--   AVG(scraping_time_ms) as avg_scraping_time_ms,
--   AVG(ranking_time_ms) as avg_ranking_time_ms,
--   AVG(user_rating) as avg_user_rating,
--   MAX(created_at) as last_search_at,
--   MIN(created_at) as first_search_at
-- FROM public.user_search_queries
-- GROUP BY user_id;

-- -- Grant permissions on the view
-- GRANT SELECT ON public.user_search_history TO authenticated;
-- GRANT SELECT ON public.user_search_history TO service_role;

-- -- Create RLS policy for the view
-- ALTER VIEW public.user_search_history SET (security_invoker = on);
