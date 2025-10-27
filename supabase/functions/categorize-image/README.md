# Categorize Image Edge Function

## Overview
This edge function categorizes individual vehicle inspection images using AI analysis. It's designed to be called concurrently for multiple images, enabling parallel processing of all inspection photos, OBD2 screenshots, and title images simultaneously.

## Purpose
- **Single Image Categorization**: Processes one image at a time
- **Concurrent Processing**: Called simultaneously from `run-inspection` for all images
- **Database Updates**: Automatically updates the appropriate table (photos, obd2_codes, or title_images)
- **Vehicle Data Extraction**: Extracts and updates vehicle details when found in images

## API Endpoint
```
POST /functions/v1/categorize-image
```

## Request Payload

```typescript
{
  // Required fields
  image_url: string,           // URL of the image to categorize
  image_id: string,            // Database ID (photo.id, obd2_code.id, or title_image.id)
  inspection_id: string,       // Inspection ID for vehicle data updates
  
  // Optional fields
  image_type?: string,         // 'photo' | 'obd2' | 'title' (default: 'photo')
  user_id?: string,            // User ID for logging
  inspection_type?: string     // 'extension' | 'detail' | 'url' | 'webhook'
}
```

## Response

### Success Response (200)
```json
{
  "success": true,
  "image_id": "uuid",
  "category": "exterior",
  "confidence": 0.95,
  "reasoning": "Image shows vehicle exterior with clear view of body panels",
  "has_vehicle_data": true,
  "duration_ms": 2500
}
```

### Error Response (400/500)
```json
{
  "success": false,
  "error": "Missing required fields: image_url, image_id, inspection_id",
  "duration_ms": 50
}
```

## Image Categories
- `exterior` - Vehicle exterior shots
- `interior` - Interior cabin views
- `dashboard` - Dashboard and instrument cluster
- `engine` - Engine bay photos
- `undercarriage` - Underside and chassis
- `paint` - Paint condition close-ups
- `rust` - Rust and corrosion
- `obd` - OBD scanner screenshots
- `title` - Vehicle title documents
- `records` - Service/maintenance records

## Features

### 1. AI-Powered Categorization
- Uses `image_details_extraction` Dify function via `function-call` service
- Extracts structured vehicle data (VIN, Make, Model, Year, Mileage, etc.)
- Stores full LLM analysis in database

### 2. Intelligent Vehicle Data Updates
- **VIN Protection**: For `extension` and `detail` types, protects existing VIN from being overwritten
- **Partial VIN Completion**: Completes partial VINs (e.g., `****1234`) with full VINs when matched
- **Mileage Protection**: Preserves user-provided or screenshot-extracted mileage
- **Field Protection**: When VIN exists from screenshot, protects Make, Year, Model, Body Style, Drivetrain, Title Status from gallery image overwrites

### 3. Concurrent Processing
When called from `run-inspection`, all images are processed simultaneously:

```typescript
// Example: 10 images processed concurrently instead of sequentially
// Sequential: 10 images × 2.5s = 25 seconds
// Concurrent: ~2.5-5 seconds total (depending on API rate limits)
```

### 4. Database Updates by Image Type

#### Photos
```sql
UPDATE photos 
SET category = 'exterior',
    llm_analysis = {...}
WHERE id = 'photo_id';
```

#### OBD2 Codes
```sql
UPDATE obd2_codes 
SET llm_analysis = {...}
WHERE id = 'obd2_id';
```

#### Title Images
```sql
UPDATE title_images 
SET llm_analysis = {...}
WHERE id = 'title_image_id';
```

## Usage from run-inspection

The `processor.ts` file calls this endpoint concurrently:

```typescript
// Old approach (sequential with batching)
await categorizeImages(photos, inspectionId, obd2_codes, title_images, type, userId);

// New approach (concurrent via endpoint)
await categorizeImagesConcurrently(
  photos, 
  inspectionId, 
  obd2_codes, 
  title_images, 
  type, 
  userId, 
  ctx
);
```

### Benefits of Concurrent Processing
1. **Speed**: 5-10x faster for large image sets
2. **Scalability**: Better utilization of Dify API rate limits
3. **Reliability**: Individual image failures don't block others
4. **Monitoring**: Per-image timing and error tracking

## Vehicle Data Extraction Flow

```mermaid
graph TD
    A[Image Received] --> B[Call function-call service]
    B --> C[Dify AI Analysis]
    C --> D{Vehicle Data Found?}
    D -->|Yes| E[Extract Vehicle Details]
    D -->|No| F[Store Category Only]
    E --> G{Inspection Type Check}
    G -->|extension/detail| H[Apply Protection Rules]
    G -->|other| I[Update All Fields]
    H --> J[Merge with Existing Data]
    I --> J
    J --> K[Update Inspection & Image Tables]
    F --> L[Update Image Table Only]
```

## Protection Rules

### For Extension & Detail Inspections

| Field | Protection Logic |
|-------|------------------|
| VIN | Protected if exists, unless new VIN completes partial VIN |
| Mileage | Protected if exists from screenshot or user input |
| Make | Protected if VIN exists from screenshot |
| Year | Protected if VIN exists from screenshot |
| Model | Protected if VIN exists from screenshot |
| Body Style | Protected if VIN exists from screenshot |
| Drivetrain | Protected if VIN exists from screenshot |
| Title Status | Protected if VIN exists from screenshot |
| Engine | Not protected - can be updated |
| Transmission | Not protected - can be updated |
| Colors | Not protected - can be updated |

## Error Handling

The function handles various error scenarios:

1. **Missing Required Fields**: Returns 400 with clear error message
2. **Function-Call Failures**: Logs error, returns 500
3. **Database Update Failures**: Logs error but doesn't fail the request
4. **JSON Parsing Errors**: Handles markdown-wrapped JSON responses
5. **Partial Failures**: Continues processing even if vehicle data extraction fails

## Logging

Comprehensive logging with timestamps:

```typescript
[CATEGORIZE_IMAGE] [2025-01-10T12:34:56.789Z] INFO: Categorize image request received
[CATEGORIZE_IMAGE] [2025-01-10T12:34:57.123Z] DEBUG: Calling function-call service
[CATEGORIZE_IMAGE] [2025-01-10T12:34:59.456Z] INFO: Image categorization completed successfully
```

## Performance Considerations

### Concurrent Limits
- No artificial limit in the endpoint itself
- Limited by:
  - Supabase Edge Function concurrency limits
  - Dify API rate limits
  - Database connection pool

### Optimization Tips
1. Process in batches if you have 100+ images
2. Monitor Dify API rate limits
3. Consider adding exponential backoff for retries
4. Use the duration_ms in response to track performance

## Example: Concurrent Processing Flow

```
Inspection with 15 images:
├── Photo 1 ──┐
├── Photo 2 ──┤
├── Photo 3 ──┤
├── Photo 4 ──┼─→ All 15 requests fire simultaneously
├── Photo 5 ──┤
├── ...       ┤
└── Photo 15 ─┘
       ↓
All complete in ~2-5 seconds
(vs 30-45 seconds sequential)
```

## Testing

### Manual Test
```bash
curl -X POST https://your-project.supabase.co/functions/v1/categorize-image \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://storage.url/image.jpg",
    "image_id": "photo-uuid",
    "inspection_id": "inspection-uuid",
    "image_type": "photo",
    "inspection_type": "extension"
  }'
```

### Integration Test
The function is automatically tested when `run-inspection` processes images.

## Deployment

```bash
# Deploy this function
supabase functions deploy categorize-image

# Deploy with updated processor
supabase functions deploy run-inspection
```

## Dependencies
- `function-call` edge function (must be deployed)
- `image_details_extraction` Dify function (must be configured in dify_function_mapping table)
- Supabase database with tables: inspections, photos, obd2_codes, title_images

## Related Files
- `/supabase/functions/categorize-image/index.ts` - Main endpoint
- `/supabase/functions/run-inspection/processor.ts` - Calls this endpoint concurrently
- `/supabase/functions/function-call/index.ts` - AI service wrapper
