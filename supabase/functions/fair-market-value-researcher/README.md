# Fair Market Value Researcher - Modular Structure

This function has been refactored into multiple files for better scalability and maintainability.

## File Structure

```
fair-market-value-researcher/
├── index.ts                           # Main entry point and HTTP handler
├── config.ts                          # Configuration, environment variables, and client initialization
├── schemas.ts                         # Schema definitions and prompts
├── utils.ts                           # Utility functions for parsing, cost calculation, etc.
├── fair-market-value-processor.ts     # Main background processing logic
└── README.md                          # This documentation
```

## Configuration

### Environment Variables

- `OPENAI_API_KEY` - Your OpenAI API key
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key

### Example Environment Configuration

```bash
# Set your API key
OPENAI_API_KEY=your_openai_api_key_here
```

## Module Descriptions

### config.ts
- Handles environment variable configuration
- Initializes Supabase and OpenAI clients
- Contains API configuration and rate settings for cost calculation

### schemas.ts
- Defines response schemas for fair market value analysis
- Contains the main fair market value analysis prompt template
- Provides structured data definitions for API responses

### utils.ts
- `calculateCost()` - Calculates OpenAI API usage costs
- `extractSearchResults()` - Extracts web search results from OpenAI responses
- `parseResponse()` - Parses and validates OpenAI API responses
- `buildVehicleSearchTerms()` - Generates search terms for vehicle market analysis
- `getExternalValuation()` - Calls external valuation API for market data

### fair-market-value-processor.ts
- `processFairMarketValue()` - Main background processing function
- Handles the complete fair market value analysis workflow
- Manages database operations and error handling
- Processes inspection results and generates market value analysis
- Integrates external valuation API results

### index.ts
- Main HTTP handler for the Supabase Edge Function
- Handles incoming requests and starts background processing
- Provides immediate response while processing continues in background

## Usage

The function works the same way as before but now with better organization:

1. Receives inspection ID in request payload
2. Finds the corresponding fair market value job
3. Starts background processing using the modular processor
4. Returns immediate response while processing continues

## Benefits of Modular Structure

1. **Maintainability** - Each file has a single responsibility
2. **Testability** - Individual modules can be tested separately
3. **Reusability** - Utility functions can be reused across different parts
4. **Scalability** - Easy to add new features or modify existing ones
5. **Debugging** - Easier to locate and fix issues in specific modules

## Key Features

- **OpenAI Integration** - Uses OpenAI GPT-4.1 with web search capabilities
- **External Valuation API** - Integrates with external vehicle valuation service
- **Cost Tracking** - Tracks API usage costs and token consumption
- **Web Search Results** - Captures and stores web search results for analysis
- **Error Handling** - Comprehensive error handling and job status management

## Development

When making changes:
- Configuration changes go in `config.ts`
- New utility functions go in `utils.ts`
- Schema or prompt changes go in `schemas.ts`
- Processing logic changes go in `fair-market-value-processor.ts`
- HTTP handling changes go in `index.ts`

## Function Naming Improvements

The following functions have been renamed for better clarity and consistency:

- `calculateApiCost()` → `calculateCost()` - More concise and matches expert-advice pattern
- `extractWebSearchResults()` → `extractSearchResults()` - Shorter and clearer
- `parseAnalysisResponse()` → `parseResponse()` - More generic and reusable
- `processFairMarketValueInBackground()` → `processFairMarketValue()` - Cleaner name without redundant "InBackground"
