-- Add email_sent field to inspections table to prevent duplicate emails
ALTER TABLE inspections 
ADD COLUMN email_sent BOOLEAN DEFAULT FALSE;

-- Create index for efficient querying
CREATE INDEX idx_inspections_email_sent ON inspections(email_sent);

-- Update existing completed inspections to mark email as sent
UPDATE inspections 
SET email_sent = TRUE 
WHERE status = 'done';
