# Send Shared Link Notifications Edge Function

## Overview
This Supabase Edge Function handles sending notifications (email and/or SMS) for shared vehicle inspection links. It supports both SMTP2GO for emails and Twilio for SMS messaging.

## Features
- ✉️ Email notifications via SMTP2GO
- 📱 SMS notifications via Twilio
- 🔄 Supports sending both or either notification type
- 🎯 Proper error handling and status codes
- 📊 Detailed logging for debugging
- ✅ Professional email templates
- 🔐 CORS-enabled for web applications

## Environment Variables

Set these in your Supabase project settings:

### Required for Email (SMTP2GO)
```bash
SMTP2GO_API_KEY=your_smtp2go_api_key
```

### Required for SMS (Twilio)
```bash
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number  # e.g., +1234567890
```

## API Endpoint

```
POST /functions/v1/send-shared-link-notifications
```

## Request Body

```typescript
{
  recipientEmail?: string;      // Optional - recipient's email address
  recipientPhone?: string;      // Optional - recipient's phone number (E.164 format)
  shareUrl: string;            // Required - the shared link URL
  maxUses: number;             // Required - maximum number of uses
  expiresAt: string;           // Required - ISO timestamp for expiration
}
```

### Notes:
- At least one of `recipientEmail` or `recipientPhone` must be provided
- `recipientPhone` should be in E.164 format (e.g., +12345678901)
- `expiresAt` should be an ISO 8601 timestamp

## Response Formats

### Success (All notifications sent)
**Status: 200**
```json
{
  "success": true,
  "message": "All notifications sent successfully",
  "emailSent": true,
  "smsSent": true
}
```

### Partial Success (Some notifications sent)
**Status: 207 (Multi-Status)**
```json
{
  "success": true,
  "message": "Some notifications sent successfully",
  "emailSent": true,
  "smsSent": false,
  "smsError": "Twilio API error: 400"
}
```

### Failure (No notifications sent)
**Status: 500**
```json
{
  "success": false,
  "message": "Failed to send any notifications",
  "emailSent": false,
  "smsSent": false,
  "emailError": "SMTP2GO API error: 401",
  "smsError": "SMS service not configured"
}
```

### Validation Error
**Status: 400**
```json
{
  "error": "Missing required fields: shareUrl, expiresAt"
}
```

## Usage Examples

### Frontend (React/Next.js)

```typescript
// Send both email and SMS
const response = await fetch(
  `${supabaseUrl}/functions/v1/send-shared-link-notifications`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      recipientEmail: "user@example.com",
      recipientPhone: "+12345678901",
      shareUrl: "https://fixpilot.ai/start?token=abc123",
      maxUses: 5,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  }
);

const result = await response.json();

if (result.success) {
  if (result.emailSent && result.smsSent) {
    toast.success("Link created! Email and SMS sent successfully!");
  } else if (result.emailSent) {
    toast.success("Link created and email sent successfully!");
  } else if (result.smsSent) {
    toast.success("Link created and SMS sent successfully!");
  }
} else {
  toast.error("Failed to send notifications");
}
```

### Send Email Only

```typescript
const response = await fetch(
  `${supabaseUrl}/functions/v1/send-shared-link-notifications`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      recipientEmail: "user@example.com",
      shareUrl: "https://fixpilot.ai/start?token=abc123",
      maxUses: 5,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  }
);
```

### Send SMS Only

```typescript
const response = await fetch(
  `${supabaseUrl}/functions/v1/send-shared-link-notifications`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      recipientPhone: "+12345678901",
      shareUrl: "https://fixpilot.ai/start?token=abc123",
      maxUses: 5,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  }
);
```

## Integration with Shared Link Creation

Update your frontend code to use this edge function:

```typescript
// After creating shared link
createLink(
  {
    resource: "shared_links",
    values: {
      token,
      created_by: identity.id,
      recipient_email: values.recipient_email || null,
      expires_at: expiresAt.toISOString(),
      max_uses: values.max_uses,
      current_uses: 0,
      status: "active",
    },
  },
  {
    onSuccess: async (data) => {
      const url = `${
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      }/start?token=${token}`;
      setShareUrl(url);

      // Send notifications
      const notificationPayload: any = {
        shareUrl: url,
        maxUses: values.max_uses,
        expiresAt: expiresAt.toISOString(),
      };

      if (values.recipient_email) {
        notificationPayload.recipientEmail = values.recipient_email;
      }

      if (values.recipient_phone) {
        notificationPayload.recipientPhone = values.recipient_phone;
      }

      try {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/send-shared-link-notifications`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify(notificationPayload),
          }
        );

        const result = await response.json();

        setLinkCreated(true);
        
        if (result.emailSent && result.smsSent) {
          toast.success("Link created! Email and SMS sent successfully!");
        } else if (result.emailSent) {
          toast.success("Link created and email sent successfully!");
        } else if (result.smsSent) {
          toast.success("Link created and SMS sent successfully!");
        } else if (values.recipient_email || values.recipient_phone) {
          toast.warning("Link created but failed to send notifications");
        } else {
          toast.success("Link created successfully!");
        }
      } catch (error) {
        console.error("Error sending notifications:", error);
        toast.warning("Link created but failed to send notifications");
      }

      setSharedLinkCreating(false);
      invalidate({
        resource: "shared_links",
        invalidates: ["list"],
      });
    },
  }
);
```

## Email Template

The function sends a professionally formatted HTML email with:
- FixPilot branding
- Clear call-to-action button
- Expiration date information
- Responsive design
- Support information

## SMS Template

The SMS message includes:
- Brief introduction
- Share URL
- Expiration date
- Concise format to minimize costs

## Deployment

1. Deploy the function to Supabase:
```bash
supabase functions deploy send-shared-link-notifications
```

2. Set environment variables in Supabase dashboard:
   - Go to Project Settings > Edge Functions
   - Add the required environment variables

3. Test the function:
```bash
supabase functions invoke send-shared-link-notifications --data '{
  "recipientEmail": "test@example.com",
  "shareUrl": "https://fixpilot.ai/start?token=test",
  "maxUses": 1,
  "expiresAt": "2025-12-31T23:59:59Z"
}'
```

## Error Handling

The function gracefully handles:
- Missing environment variables (returns configuration error)
- SMTP2GO API failures (logs error, continues with SMS if requested)
- Twilio API failures (logs error, continues with email if requested)
- Invalid request payloads (returns 400 with details)
- Network errors (returns 500 with error details)

## Logging

The function logs:
- ✅ Successful email sends with recipient
- ✅ Successful SMS sends with SID
- ⚠️ Failed sends with error details
- 📊 Summary of notification results

## Security

- CORS headers properly configured
- Sensitive credentials stored in environment variables
- No credentials exposed in responses
- Proper authentication required (Supabase Anon Key)

## Cost Considerations

- **SMTP2GO**: Check your plan limits and pricing
- **Twilio**: SMS costs vary by country/carrier
- Monitor usage in respective dashboards

## Troubleshooting

### Email not sending
1. Verify SMTP2GO_API_KEY is set correctly
2. Check SMTP2GO account status and credits
3. Review function logs for SMTP2GO errors
4. Verify sender email is verified in SMTP2GO

### SMS not sending
1. Verify all Twilio credentials are set
2. Check Twilio phone number is verified
3. Ensure recipient phone is in E.164 format
4. Review Twilio account balance
5. Check if recipient country is supported

### Both failing
1. Check Supabase function logs
2. Verify environment variables are set
3. Test with curl/Postman to isolate issues
4. Check network connectivity

## Support

For issues or questions:
1. Check Supabase function logs
2. Review SMTP2GO/Twilio dashboards
3. Contact support if service-specific issues persist
