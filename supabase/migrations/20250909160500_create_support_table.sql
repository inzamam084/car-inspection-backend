-- Create support table to store support requests with website URL and user information
CREATE TABLE public.support (
  id uuid not null default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  website_url text not null,
  subject text,
  message text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  
  primary key (id)
);

-- Add comments to document the table and columns
COMMENT ON TABLE public.support IS 'Support requests table storing user support tickets with website URL and user information';
COMMENT ON COLUMN public.support.user_id IS 'Reference to the user who submitted the support request';
COMMENT ON COLUMN public.support.website_url IS 'URL of the website related to the support request';
COMMENT ON COLUMN public.support.subject IS 'Brief subject/title of the support request';
COMMENT ON COLUMN public.support.message IS 'Detailed message describing the support request';
COMMENT ON COLUMN public.support.status IS 'Current status of the support request (open, in_progress, resolved, closed)';
COMMENT ON COLUMN public.support.priority IS 'Priority level of the support request (low, medium, high, urgent)';
COMMENT ON COLUMN public.support.resolved_at IS 'Timestamp when the support request was resolved';

-- Enable Row Level Security
ALTER TABLE public.support ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view their own support requests
CREATE POLICY "Users can view own support requests" 
ON public.support 
FOR SELECT 
USING (auth.uid() = user_id);

-- Users can create their own support requests
CREATE POLICY "Users can create own support requests" 
ON public.support 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Users can update their own support requests (but not change status or resolved_at)
CREATE POLICY "Users can update own support requests" 
ON public.support 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Service role has full access for admin operations
CREATE POLICY "Allow service role full access" 
ON public.support 
FOR ALL 
USING (true);

-- Grant permissions to different roles
GRANT ALL ON TABLE public.support TO anon;
GRANT ALL ON TABLE public.support TO authenticated;
GRANT ALL ON TABLE public.support TO service_role;

-- Create indexes for better query performance
CREATE INDEX idx_support_user_id ON public.support(user_id);
CREATE INDEX idx_support_status ON public.support(status);
CREATE INDEX idx_support_priority ON public.support(priority);
CREATE INDEX idx_support_created_at ON public.support(created_at DESC);
CREATE INDEX idx_support_website_url ON public.support(website_url);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_support_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Create trigger to automatically update updated_at on row updates
CREATE TRIGGER update_support_updated_at_trigger
    BEFORE UPDATE ON public.support
    FOR EACH ROW
    EXECUTE FUNCTION public.update_support_updated_at();
