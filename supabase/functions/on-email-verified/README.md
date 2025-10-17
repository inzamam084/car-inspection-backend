# On Email Verified Edge Function

This edge function is triggered when a user verifies their email address and sends them a welcome email with links to download the Chrome extension and iOS app.

## Setup

### 1. Deploy the Edge Function

```bash
supabase functions deploy on-email-verified --no-verify-jwt
```

### 2. Set Environment Variables

Set the following secrets for your edge function:

```bash
supabase secrets set RESEND_API_KEY=your_resend_api_key
```

The following are automatically available:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### 3. Configure Database Webhook

#### Option A: Using Supabase Dashboard (Recommended)

1. Go to your Supabase Dashboard
2. Navigate to Database → Webhooks
3. Click "Create a new webhook"
4. Configure as follows:
   - **Name**: `on-email-verified`
   - **Table**: `auth.users`
   - **Events**: Select `UPDATE`
   - **Conditions**: Add filter: `email_confirmed_at IS NOT NULL AND old.email_confirmed_at IS NULL`
   - **Type**: `HTTP Request`
   - **URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/on-email-verified`
   - **HTTP Headers**:
     ```
     Authorization: Bearer YOUR_SERVICE_ROLE_KEY
     Content-Type: application/json
     ```

#### Option B: Using SQL (Alternative)

Run the migration files:
```bash
supabase db push
```

### 4. Test the Function

You can test the function manually:

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/on-email-verified \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "email_verified",
    "user_id": "test-user-id",
    "email": "test@example.com",
    "verified_at": "2024-01-01T00:00:00Z"
  }'
```

## Webhook Payload

The function expects the following payload structure:

```json
{
  "event": "email_verified",
  "user_id": "uuid",
  "email": "user@example.com",
  "verified_at": "2024-01-01T00:00:00Z"
}
```

## Email Template

The welcome email includes:
- Welcome message
- Link to Chrome extension for online auction inspections
- Link to iOS app for in-person vehicle inspections
- Professional HTML template with responsive design

## Tracking

The function tracks whether a welcome email has been sent by:
1. Setting `welcome_email_sent = true` in the profiles table
2. Recording the timestamp in `welcome_email_sent_at`
3. Preventing duplicate emails if the user somehow triggers verification multiple times

## Error Handling

- If RESEND_API_KEY is not configured, the function returns an error
- If the user profile cannot be found, the function continues anyway
- If email sending fails, the error is logged and returned
- Profile update failures don't cause the whole request to fail

## Monitoring

Check the function logs:
```bash
supabase functions logs on-email-verified
```

Check audit logs in the database:
```sql
SELECT * FROM public.audit_logs 
WHERE event_type = 'email_verified' 
ORDER BY created_at DESC;
```

## Troubleshooting

1. **Function not triggering**: Check webhook configuration in Dashboard
2. **Email not sending**: Verify RESEND_API_KEY is set correctly
3. **Authentication errors**: Ensure service role key is used in webhook headers
4. **Duplicate emails**: Check `welcome_email_sent` field in profiles table
