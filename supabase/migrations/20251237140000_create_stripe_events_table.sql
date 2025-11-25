-- Migration: Create stripe_events table for webhook idempotency
-- Purpose: Prevent duplicate webhook processing by tracking processed event IDs
-- Reference: https://docs.stripe.com/webhooks (Best Practices - Handle Duplicate Events)

CREATE TABLE IF NOT EXISTS stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster lookups by event_id
CREATE INDEX IF NOT EXISTS idx_stripe_events_event_id ON stripe_events(event_id);

-- Create index for faster lookups by event_type (useful for analytics)
CREATE INDEX IF NOT EXISTS idx_stripe_events_event_type ON stripe_events(event_type);

-- Create index for cleanup queries (delete old events)
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at ON stripe_events(processed_at);

-- Add comments to describe table and columns
COMMENT ON TABLE stripe_events IS 'Tracks processed Stripe webhook events to prevent duplicate processing';
COMMENT ON COLUMN stripe_events.event_id IS 'Unique Stripe event ID (evt_xxx)';
COMMENT ON COLUMN stripe_events.event_type IS 'Type of Stripe event (e.g., invoice.payment_succeeded)';
COMMENT ON COLUMN stripe_events.processed_at IS 'Timestamp when the event was successfully processed';

