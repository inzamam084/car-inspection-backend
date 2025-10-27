# Quick Start: Dify Workflow Integration

## 1. Set Environment Variables

```bash
# Add to .env or Supabase secrets
DIFY_API_URL=https://api.dify.ai/v1
DIFY_API_KEY=your-api-key-here
```

Set in Supabase:
```bash
supabase secrets set DIFY_API_KEY=your-api-key-here
```

## 2. Dify Workflow Configuration

Your Dify workflow must have these **INPUT FIELDS**:

| Field Name | Type | Description |
|------------|------|-------------|
| `image` | File Array (image) | The car image to analyze |
| `inspection_id` | String | Inspection ID |
| `user_id` | String | User ID |
| `image_id` | String | Image ID |
| `image_type` | String | Table name: "photos", "obd2_codes", or "title_images" |

## 3. Example API Call to Dify

The code automatically sends requests like this:

```bash
curl -X POST 'https://api.dify.ai/v1/workflows/run' \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "inputs": {
      "image": [
        {
          "type": "image",
          "transfer_method": "remote_url",
          "url": "https://storage.url/image.jpg"
        }
      ],
      "inspection_id": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": "user-123",
      "image_id": "img-456",
      "image_type": "photos"
    },
    "response_mode": "blocking",
    "user": "user-123"
  }'
```

## 4. How It Works

```
1. User triggers inspection
   ↓
2. System fetches images from database
   ↓
3. For each image, call Dify workflow with:
   - Image URL
   - Inspection ID
   - User ID
   - Image ID
   - Image Type
   ↓
4. Dify processes image and returns analysis
   ↓
5. Results stored/processed
   ↓
6. If Dify fails, fallback to categorization
```

## 5. Testing

```bash
# Deploy function
cd supabase/functions/run-inspection
supabase functions deploy run-inspection

# Test with inspection
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/run-inspection \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"inspection_id": "your-inspection-id"}'

# Check logs
supabase functions logs run-inspection --tail
```

## 6. Key Functions

### `callDifyWorkflow()`
Sends single image to Dify with parameters

### `processImagesWithDifyWorkflow()`
Processes all inspection images concurrently

### `runAnalysisInBackground()`
Main entry point - calls Dify processing automatically

### ✅ What Gets Sent to Dify

For each image from the database:
- ✅ Image URL (publicly accessible)
- ✅ Inspection ID
- ✅ User ID  
- ✅ Image ID (UUID)
- ✅ Image Type (table name: "photos", "obd2_codes", or "title_images")

## 8. Retry Logic

- 🔄 Automatic retries: 3 attempts
- ⏱️ Delays: 1s, 2s, 4s (exponential backoff)
- 🛡️ Handles network/timeout errors

## 9. Error Handling

- If Dify fails → Falls back to existing categorization
- Each image isolated → One failure doesn't stop others
- All errors logged with context

## 10. Monitoring

Check these logs for success:
```
✅ "Calling Dify workflow"
✅ "Dify workflow completed"
✅ "Dify workflow processing completed"
```

Check these logs for issues:
```
❌ "Dify workflow failed"
❌ "Failed to process photo X with Dify"
⚠️  "Dify workflow processing failed, trying fallback"
```

## Complete Example

```typescript
// This happens automatically in runAnalysisInBackground()

// 1. Fetch inspection data
const { data: inspectionData } = await Database.batchFetchInspectionData(inspectionId);

// 2. Process images through Dify
await processImagesWithDifyWorkflow(
  inspectionData.photos,           // Array of photo objects
  inspectionId,                     // "550e8400-e29b-..."
  inspectionData.obd2_codes,        // Array of OBD2 objects
  inspectionData.title_images,      // Array of title image objects
  ctx.userId || "anonymous",        // User ID
  ctx                               // Request context for logging
);

// 3. Results are processed and stored automatically
```

## Checklist

- [ ] Dify workflow created with correct input fields
- [ ] Dify API key obtained
- [ ] Environment variables set in Supabase
- [ ] Function deployed
- [ ] Test inspection created
- [ ] Logs monitored for success
- [ ] Error handling verified

## Support

If images aren't being processed:
1. Check `DIFY_API_KEY` is set
2. Verify workflow is published in Dify
3. Ensure image URLs are accessible
4. Check function logs for errors
5. Verify workflow input field names match exactly

---

**That's it!** The integration is automatic once environment variables are configured.
