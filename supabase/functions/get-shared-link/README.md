# Get Shared Link Edge Function

## Overview
Supabase Edge Function to fetch shared link data by token, including creator profile information. Uses service role key to bypass RLS, enabling both authenticated and anonymous users to access shared links.

## Endpoint
```
GET /functions/v1/get-shared-link?token=YOUR_TOKEN
```

## Authentication
Requires Supabase Anon Key in Authorization header:
```
Authorization: Bearer YOUR_SUPABASE_ANON_KEY
```

## Request Parameters

### Query Parameters
- `token` (required): The shared link token to fetch

**Example:**
```
GET /functions/v1/get-shared-link?token=abc123xyz
```

## Response Format

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "token": "abc123xyz",
    "created_by": "user-uuid",
    "recipient_email": "recipient@example.com",
    "expires_at": "2025-12-31T23:59:59Z",
    "max_uses": 5,
    "current_uses": 2,
    "status": "active",
    "metadata": {},
    "first_accessed_at": "2025-01-01T10:00:00Z",
    "last_accessed_at": "2025-01-15T14:30:00Z",
    "completed_at": null,
    "revoked_at": null,
    "revoked_by": null,
    "revoke_reason": null,
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-15T14:30:00Z",
    "profiles": {
      "id": "user-uuid",
      "email": "creator@example.com",
      "first_name": "John",
      "last_name": "Doe"
    }
  }
}
```

### Error Responses

#### Token Not Found (404)
```json
{
  "success": false,
  "error": "Shared link not found"
}
```

#### Link Expired (403)
```json
{
  "success": false,
  "data": { /* link data */ },
  "error": "Shared link has expired",
  "isExpired": true
}
```

#### Maximum Uses Reached (403)
```json
{
  "success": false,
  "data": { /* link data */ },
  "error": "Shared link has reached maximum uses",
  "isMaxedOut": true
}
```

#### Link Inactive/Revoked (403)
```json
{
  "success": false,
  "data": { /* link data */ },
  "error": "Shared link is revoked",
  "isInactive": true
}
```

#### Missing Token (400)
```json
{
  "success": false,
  "error": "Token parameter is required"
}
```

#### Server Error (500)
```json
{
  "success": false,
  "error": "Internal server error"
}
```

## Validation Logic

The function performs the following validations:

1. **Existence Check**: Verifies token exists in database
2. **Expiration Check**: Compares `expires_at` with current time
3. **Usage Check**: Verifies `current_uses < max_uses`
4. **Status Check**: Ensures status is `active`

## Database Schema

The function queries the following tables:

### shared_links
```sql
CREATE TABLE shared_links (
  id uuid PRIMARY KEY,
  token text UNIQUE NOT NULL,
  created_by uuid REFERENCES profiles(id),
  recipient_email text,
  expires_at timestamp with time zone NOT NULL,
  max_uses integer NOT NULL DEFAULT 1,
  current_uses integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  -- ... other fields
);
```

### profiles
```sql
CREATE TABLE profiles (
  id uuid PRIMARY KEY,
  email text,
  first_name text,
  last_name text,
  -- ... other fields
);
```

## Environment Variables

Required environment variables (automatically set by Supabase):

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (admin access)

## Deployment

### Deploy the function
```bash
supabase functions deploy get-shared-link
```

### Set secrets (if needed)
```bash
supabase secrets set SUPABASE_URL=your_url
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_key
```

### Test the function locally
```bash
supabase functions serve get-shared-link
```

### Test with curl
```bash
curl -X GET "http://localhost:54321/functions/v1/get-shared-link?token=test123" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json"
```

## Usage Example

### JavaScript/TypeScript
```typescript
const fetchSharedLink = async (token: string) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  const response = await fetch(
    `${supabaseUrl}/functions/v1/get-shared-link?token=${token}`,
    {
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
    }
  )
  
  const data = await response.json()
  
  if (!response.ok) {
    if (data.isExpired) {
      console.log('Link expired')
    } else if (data.isMaxedOut) {
      console.log('Max uses reached')
    }
    throw new Error(data.error)
  }
  
  return data.data
}
```

### React Hook Example
```typescript
import { useEffect, useState } from 'react'

function useSharedLink(token: string) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  useEffect(() => {
    if (!token) return
    
    fetchSharedLink(token)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [token])
  
  return { data, loading, error }
}
```

## Security Considerations

### Why Service Role Key?
- Bypasses Row Level Security (RLS) policies
- Allows anonymous users to fetch shared links
- Safe because validation happens server-side
- No client-side exposure of service role key

### CORS Configuration
The function allows all origins (`*`) for flexibility. In production, consider restricting to specific domains:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

## Error Handling

The function includes comprehensive error handling:

1. **Database Errors**: Caught and logged
2. **Missing Token**: Returns 400 with clear message
3. **Not Found**: Returns 404 when token doesn't exist
4. **Validation Failures**: Returns 403 with specific flags
5. **Server Errors**: Returns 500 with generic message

## Performance Considerations

- **Single Query**: Uses SQL join to fetch link + profile in one query
- **Indexed Lookup**: Token field is indexed for fast lookups
- **Early Validation**: Checks existence before expensive validations
- **Edge Deployment**: Runs close to users globally

## Monitoring

### Logs
View function logs:
```bash
supabase functions logs get-shared-link
```

### Metrics to Track
- Request count
- Error rate
- Response time
- 404 rate (invalid tokens)
- 403 rate (expired/maxed links)

## Testing

### Unit Test Example
```typescript
Deno.test("get-shared-link returns valid data", async () => {
  const response = await fetch(
    "http://localhost:54321/functions/v1/get-shared-link?token=valid_token",
    {
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
    }
  )
  
  const data = await response.json()
  
  assertEquals(response.status, 200)
  assertEquals(data.success, true)
  assertExists(data.data)
  assertExists(data.data.profiles)
})
```

## Troubleshooting

### Issue: "Shared link not found"
- Verify token is correct
- Check if link exists in database
- Ensure database connection is working

### Issue: Function returns 500
- Check function logs for details
- Verify environment variables are set
- Test database connection
- Verify foreign key relationship exists

### Issue: CORS errors
- Ensure CORS headers are properly set
- Check browser console for specific CORS error
- Verify request includes required headers

### Issue: Slow response times
- Check database indexes on `token` column
- Monitor Supabase dashboard for performance
- Consider caching frequently accessed links

## Related Functions

- `validate_shared_link`: SQL function for validation
- `mark_shared_link_accessed`: Increment usage counter
- `link_inspection_to_shared_link`: Link inspection to token
- `revoke_shared_link`: Revoke an active link

## Future Enhancements

1. Rate limiting per IP/token
2. Analytics tracking (views, clicks)
3. Webhook notifications on access
4. Link preview generation
5. Custom expiration warnings
6. Geolocation tracking
7. Device fingerprinting

## Support

For issues or questions:
1. Check function logs: `supabase functions logs get-shared-link`
2. Review Supabase dashboard for errors
3. Test locally before deploying
4. Contact support with logs and error details
