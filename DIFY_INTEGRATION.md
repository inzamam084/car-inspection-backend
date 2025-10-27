# Dify Workflow Integration Guide

This document explains how the Dify workflow has been integrated into the car inspection backend.

## Overview

The integration allows processing car inspection images through a Dify workflow. Each image (photo, OBD2 screenshot, or title image) is sent to Dify with metadata for AI-powered analysis.

## Configuration

### Environment Variables

Add these environment variables to your `.env` file or Supabase Edge Function secrets:

```bash
DIFY_API_URL=https://api.dify.ai/v1  # or your custom Dify instance URL
DIFY_API_KEY=your-dify-api-key-here
```

### Setting Supabase Secrets

```bash
supabase secrets set DIFY_API_URL=https://api.dify.ai/v1
supabase secrets set DIFY_API_KEY=your-dify-api-key-here
```

## Workflow Input Parameters

The Dify workflow expects the following input parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | File Array | Yes | Array containing image object with `type`, `transfer_method`, and `url` |
| `inspection_id` | String | Yes | Unique identifier for the inspection |
| `user_id` | String | Yes | User identifier |
| `image_id` | String | Yes | Unique identifier for the image |
| `image_type` | String | Yes | Table name where image is stored: "photos", "obd2_codes", or "title_images" |

### Example Input Payload

```json
{
  "inputs": {
    "image": [
      {
        "type": "image",
        "transfer_method": "remote_url",
        "url": "https://your-storage.com/path/to/image.jpg"
      }
    ],
    "inspection_id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "user-123",
    "image_id": "img-456",
    "image_type": "photos"
    },
    "response_mode": "blocking",
    "user": "user-123"
    }
```

## Code Implementation

### 1. Configuration (`config.ts`)

```typescript
export const DIFY_CONFIG = {
  apiUrl: Deno.env.get("DIFY_API_URL") || "https://api.dify.ai/v1",
  apiKey: Deno.env.get("DIFY_API_KEY") || "",
};
```

### 2. Core Functions (`processor.ts`)

#### `callDifyWorkflow()`
- Sends image and metadata to Dify workflow
- Handles blocking response (waits for complete result)
- Returns workflow execution result directly

#### `processImagesWithDifyWorkflow()`
- Processes multiple images concurrently
- Applies retry logic with exponential backoff
- Handles photos, OBD2 screenshots, and title images
- Provides detailed logging and error handling

### 3. Integration Flow

```
runAnalysisInBackground()
  ↓
processImagesWithDifyWorkflow()
  ↓
[Concurrent Processing]
  ↓
callDifyWorkflow() [with retry logic]
  ↓
Dify API (/workflows/run)
  ↓
[Streaming Response Processing]
  ↓
Result Storage
```

### 4. Fallback Mechanism

If Dify workflow fails, the system automatically falls back to the existing `categorizeImagesConcurrently()` function to ensure inspection processing continues.

## Features

### ✅ Concurrent Processing
- All images are processed simultaneously
- Reduces total processing time
- Efficient resource utilization

### ✅ Retry Logic
- Exponential backoff (1s, 2s, 4s)
- Maximum 3 retries per image
- Handles transient failures gracefully

### ✅ Comprehensive Logging
- Detailed request/response logging
- Performance metrics
- Error tracking with context

### ✅ Error Handling
- Per-image error isolation
- Fallback to categorization
- Inspection status updates

### ✅ Blocking Mode
- Simplified response handling
- Complete result returned at once
- No streaming complexity
- Easier debugging

## Response Format

### Blocking Mode Response

When using `response_mode: "blocking"`, the API returns a complete JSON response immediately after workflow execution:

```json
{
  "workflow_run_id": "550e8400-e29b-41d4-a716-446655440000",
  "task_id": "task-123",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "workflow_id": "workflow-789",
    "status": "succeeded",
    "outputs": {
      "category": "exterior_damage",
      "confidence": 0.95,
      "analysis": "Front bumper shows minor scratches..."
    },
    "error": null,
    "elapsed_time": 2.5,
    "total_tokens": 1234,
    "total_steps": 3,
    "created_at": 1705395332,
    "finished_at": 1705395335
  }
}
```

### Final Result Structure

```typescript
{
  id: string;                    // Workflow execution ID
  workflow_id: string;           // Workflow template ID
  status: "succeeded" | "failed" | "stopped";
  outputs: object;               // Workflow output data
  error?: string;                // Error message if failed
  elapsed_time: number;          // Total execution time (seconds)
  total_tokens?: number;         // Tokens consumed
  total_steps: number;           // Number of workflow steps
  created_at: number;            // Timestamp
  finished_at: number;           // Timestamp
}
```

## Testing

### 1. Test Single Image Processing

```typescript
const result = await callDifyWorkflow(
  "https://example.com/car-photo.jpg",
  "img-123",
  "photo",
  "inspection-456",
  "user-789",
  ctx
);
console.log("Workflow result:", result);
```

### 2. Test Full Inspection Flow

```bash
# Trigger inspection
curl -X POST https://your-supabase-url.com/functions/v1/run-inspection \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"inspection_id": "your-inspection-id"}'
```

### 3. Monitor Logs

Check Supabase Edge Function logs for detailed execution information:

```bash
supabase functions logs run-inspection --tail
```

## Troubleshooting

### Common Issues

1. **Missing API Key**
   - Error: "DIFY_API_KEY not configured"
   - Solution: Set the `DIFY_API_KEY` environment variable

2. **Workflow Not Found**
   - Error: HTTP 404
   - Solution: Verify workflow is published in Dify

3. **Image URL Not Accessible**
   - Error: Dify cannot fetch image
   - Solution: Ensure image URLs are publicly accessible or use proper authentication

4. **Timeout Issues**
   - Error: Request timeout
   - Solution: Check Dify workflow complexity and execution time

### Debug Mode

Enable detailed logging by checking the RequestContext logs:

```typescript
ctx.debug("Processing image", {
  image_id: imageId,
  image_url: imageUrl,
  inspection_id: inspectionId
});
```

## Performance Considerations

- **Concurrent Processing**: All images processed in parallel
- **Average Processing Time**: ~2-5 seconds per image (depending on workflow complexity)
- **Retry Overhead**: Additional 3-7 seconds for failed requests
- **Memory Usage**: Minimal due to streaming response handling

## Security Best Practices

1. ✅ Store API keys in environment variables, never in code
2. ✅ Use HTTPS for all Dify API communications
3. ✅ Validate image URLs before sending to Dify
4. ✅ Implement rate limiting if needed
5. ✅ Monitor API usage and costs

## Next Steps

1. Configure your Dify workflow with the required input fields
2. Set up environment variables
3. Test with sample inspection
4. Monitor logs and performance
5. Adjust retry configuration if needed

## Support

For issues or questions:
- Check Supabase function logs
- Review Dify workflow execution logs
- Verify API key and configuration
- Check network connectivity to Dify API

---

Last Updated: October 2025
