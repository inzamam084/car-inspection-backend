# Gemini AI Configuration

## Environment Variables

The AI features require a Gemini API key to be configured in Supabase secrets.

### Setting up GEMINI_API_KEY

1. **Get Your API Key**:
   - Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Create or copy your Gemini API key

2. **Add to Supabase Secrets**:
   ```bash
   # Using Supabase CLI
   supabase secrets set GEMINI_API_KEY=your_api_key_here
   ```

   Or via Supabase Dashboard:
   - Go to your project dashboard
   - Navigate to Settings > Edge Functions
   - Add secret: `GEMINI_API_KEY` with your API key value

3. **Verify Configuration**:
   The service will automatically read `Deno.env.get("GEMINI_API_KEY")` at runtime.
   If the key is missing, API calls will fail with an appropriate error message.

## API Endpoints

### POST /run-inspection/ai/generate-filters
Generate search filters from natural language description.

**Request Body**:
```json
{
  "description": "Honda Civics from 2015 to 2020 under $15000",
  "platformName": "Craigslist",
  "availableFilters": {
    "make": { "label": "Make", "type": "input", "dataType": "string" },
    "year_min": { "label": "Min Year", "type": "input", "dataType": "number" }
  }
}
```

**Response**:
```json
{
  "success": true,
  "filters": {
    "make": "honda civic",
    "year_min": "2015",
    "year_max": "2020",
    "max_price": "15000"
  }
}
```

### POST /run-inspection/ai/rank-listings
Rank scraped listings based on relevance to user description.

**Request Body**:
```json
{
  "description": "Honda Civics from 2015 to 2020",
  "listings": [
    {
      "index": 0,
      "url": "https://...",
      "data": {
        "vin": "...",
        "mileage": "50000",
        "notes": "2016 Honda Civic...",
        "gallery_images": [...]
      }
    }
  ]
}
```

**Response**:
```json
{
  "success": true,
  "rankedListings": [
    {
      "index": 0,
      "reasoning": "Matches year range and make/model perfectly",
      "score": 95
    }
  ]
}
```

## Model Configuration

- **Model**: `gemini-2.0-flash-exp`
- **Filter Generation**: temperature=0.1, maxTokens=1024
- **Listing Ranking**: temperature=0.2, maxTokens=2048

## Security

- API key is stored as environment variable (never exposed to clients)
- All endpoints require authentication via `authMiddleware`
- JWT token must be provided in `Authorization: Bearer <token>` header
