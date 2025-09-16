# Car Inspection Backend - Dynamic API Usage

The function-call has been updated to support dynamic values for car inspection. Here's how to use it:

## Updated Function Call Structure

The existing endpoint now accepts dynamic parameters and will populate them automatically based on the function type (completion or workflow).

### For Completion Type Functions

```javascript
{
  "function_name": "car-inspection-completion",
  "user_id": "user-123",
  "inspection_id": "insp-456", // optional
  "response_mode": "blocking", // or "streaming"
  "query": "Analyze this car dashboard for any warning lights or issues",
  "vehicle_make": "Toyota",
  "vehicle_model": "Camry",
  "vehicle_year": "2023",
  "files": [
    {
      "type": "image",
      "transfer_method": "remote_url",
      "url": "https://your-storage.com/dashboard-image.jpg"
    },
    {
      "type": "image", 
      "transfer_method": "remote_url",
      "url": "https://your-storage.com/exterior-image.jpg"
    }
  ]
}
```

### For Workflow Type Functions

```javascript
{
  "function_name": "car-inspection-workflow",
  "user_id": "user-123", 
  "inspection_id": "insp-456", // optional
  "response_mode": "blocking", // or "streaming"
  "query": "Perform comprehensive car inspection",
  "inspection_query": "Check exterior damage and interior condition",
  "vehicle_make": "Honda",
  "vehicle_model": "Civic", 
  "vehicle_year": "2022",
  "vehicle_vin": "1HGBH41JXMN109186",
  "inspection_type": "complete_inspection",
  "files": [
    {
      "type": "image",
      "transfer_method": "remote_url", 
      "url": "https://your-storage.com/car-exterior.jpg"
    },
    {
      "type": "image",
      "transfer_method": "remote_url",
      "url": "https://your-storage.com/car-interior.jpg"
    }
  ]
}
```

## What Changed

### Dynamic Value Population

The function now dynamically populates values instead of using hardcoded ones:

**Before:**
```javascript
{
  inputs: { query: "Provide the results with the image url" },
  response_mode: "blocking",
  user: "abc-123",
  files: [
    {
      type: "image",
      transfer_method: "remote_url", 
      url: "https://hardcoded-url.jpg"
    }
  ]
}
```

**After:**
```javascript
// For completion type
{
  inputs: { 
    query: rest.query || "Provide the results with the image url",
    ...rest // All other parameters passed through
  },
  response_mode: response_mode,
  user: userId || "abc-123",
  files: files || []
}

// For workflow type  
{
  inputs: {
    images: files || [],
    inspection_query: rest.query || rest.inspection_query || "Analyze the car inspection images",
    user_id: userId || "abc-123",
    inspection_id: inspection_id,
    ...rest // All other parameters passed through
  },
  response_mode: response_mode,
  user: userId || "abc-123"
}
```

## Usage Examples

### Basic Car Dashboard Inspection

```bash
curl -X POST "https://your-supabase-url.com/functions/v1/function-call" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "function_name": "dashboard-inspection",
    "user_id": "user-123",
    "query": "Check dashboard for warning lights and issues",
    "vehicle_make": "Toyota",
    "files": [
      {
        "type": "image",
        "transfer_method": "remote_url",
        "url": "https://example.com/dashboard.jpg"
      }
    ]
  }'
```

### Multi-Image Car Inspection

```bash
curl -X POST "https://your-supabase-url.com/functions/v1/function-call" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "function_name": "complete-car-inspection", 
    "user_id": "inspector-456",
    "inspection_id": "insp-789",
    "response_mode": "streaming",
    "inspection_query": "Comprehensive vehicle inspection",
    "vehicle_make": "Honda",
    "vehicle_model": "Accord",
    "vehicle_year": "2024",
    "inspection_type": "complete_inspection",
    "files": [
      {
        "type": "image",
        "transfer_method": "remote_url",
        "url": "https://example.com/exterior.jpg"
      },
      {
        "type": "image", 
        "transfer_method": "remote_url",
        "url": "https://example.com/interior.jpg"
      },
      {
        "type": "image",
        "transfer_method": "remote_url", 
        "url": "https://example.com/engine.jpg"
      }
    ]
  }'
```

### JavaScript/TypeScript Client Example

```typescript
interface CarInspectionRequest {
  function_name: string;
  user_id?: string;
  inspection_id?: string;
  response_mode?: 'blocking' | 'streaming';
  query?: string;
  inspection_query?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year?: string;
  vehicle_vin?: string;
  inspection_type?: string;
  files: Array<{
    type: string;
    transfer_method: string;
    url: string;
  }>;
}

async function inspectCar(data: CarInspectionRequest) {
  const response = await fetch('/functions/v1/function-call', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`
    },
    body: JSON.stringify(data)
  });
  
  return response.json();
}

// Usage
const result = await inspectCar({
  function_name: 'car-damage-assessment',
  user_id: 'user-123',
  query: 'Assess exterior damage on this vehicle',
  vehicle_make: 'Ford',
  vehicle_model: 'F-150',
  vehicle_year: '2023',
  files: [
    {
      type: 'image',
      transfer_method: 'remote_url',
      url: 'https://storage.example.com/damage-photo.jpg'
    }
  ]
});
```

## Key Benefits

1. **Dynamic Parameters**: No more hardcoded values - all parameters are now dynamic
2. **Flexible Input**: Support for any additional parameters through the `...rest` spread
3. **Backward Compatible**: Existing calls will still work with fallback values  
4. **Multiple File Support**: Can handle multiple images for comprehensive inspections
5. **Type Support**: Works with both completion and workflow function types
6. **User Context**: Properly handles user IDs and inspection IDs

## Response Format

The response remains the same:

```json
{
  "success": true,
  "payload": "Detailed inspection analysis...",
  "metadata": {
    "usage": {
      "prompt_tokens": 150,
      "completion_tokens": 300,
      "total_tokens": 450,
      "total_price": "0.002"
    }
  }
}
```

This implementation provides maximum flexibility while maintaining simplicity!
