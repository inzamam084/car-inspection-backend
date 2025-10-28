-- Create registration_tokens table
CREATE TABLE IF NOT EXISTS public.registration_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'used', 'revoked')),
  metadata JSONB,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on token for faster lookups
CREATE INDEX IF NOT EXISTS idx_registration_tokens_token ON public.registration_tokens(token);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_registration_tokens_status ON public.registration_tokens(status);

-- Create index on expires_at for cleanup queries
CREATE INDEX IF NOT EXISTS idx_registration_tokens_expires_at ON public.registration_tokens(expires_at);

-- Create index on created_by for user-specific queries
CREATE INDEX IF NOT EXISTS idx_registration_tokens_created_by ON public.registration_tokens(created_by);

-- Create trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_registration_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_registration_tokens_updated_at
  BEFORE UPDATE ON public.registration_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_registration_tokens_updated_at();