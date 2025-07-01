# Expert Advice Researcher - Modular Structure

This function has been refactored into multiple files for better scalability and maintainability.

## File Structure

```
expert-advice-researcher/
├── index.ts                    # Main entry point and HTTP handler
├── config.ts                   # Configuration, environment variables, and client initialization
├── schemas.ts                  # Schema definitions and prompts
├── utils.ts                    # Utility functions for parsing, cost calculation, etc.
├── expert-advice-processor.ts  # Main background processing logic
└── README.md                   # This documentation
```

## Configuration

### Environment Variables

- `GEMINI_MODEL` - The Gemini model to use (default: `gemini-2.0-flash-exp`)
  - Available options: `gemini-2.0-flash-exp`, `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-pro`
- `GEMINI_API_KEY` - Your Google Gemini API key
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key

### Example Environment Configuration

```bash
# Use a different Gemini model
GEMINI_MODEL=gemini-1.5-pro

# Set your API key
GEMINI_API_KEY=your_api_key_here
```

## Module Descriptions

### config.ts
- Handles environment variable configuration
- Initializes Supabase and Gemini clients
- Provides dynamic model switching via `GEMINI_MODEL` environment variable
- Contains API configuration and rate settings

### schemas.ts
- Defines response schemas for expert advice analysis
- Contains the main expert advice prompt template
- Provides structured data definitions for API responses

### utils.ts
- `calculateCost()` - Calculates API usage costs
- `extractSearchResults()` - Extracts web search results from Gemini responses
- `parseResponse()` - Parses and validates Gemini API responses
- `buildVehicleSearchTerms()` - Generates search terms for vehicle analysis
- `extractIssues()` - Extracts key issues from inspection results

### expert-advice-processor.ts
- `processExpertAdvice()` - Main background processing function
- Handles the complete expert advice analysis workflow
- Manages database operations and error handling
- Processes inspection results and generates expert advice

### index.ts
- Main HTTP handler for the Supabase Edge Function
- Handles incoming requests and starts background processing
- Provides immediate response while processing continues in background

## Usage

The function works the same way as before but now with better organization:

1. Receives inspection ID in request payload
2. Finds the corresponding expert advice job
3. Starts background processing using the modular processor
4. Returns immediate response while processing continues

## Benefits of Modular Structure

1. **Maintainability** - Each file has a single responsibility
2. **Testability** - Individual modules can be tested separately
3. **Reusability** - Utility functions can be reused across different parts
4. **Scalability** - Easy to add new features or modify existing ones
5. **Configuration** - Dynamic model switching via environment variables
6. **Debugging** - Easier to locate and fix issues in specific modules

## Development

When making changes:
- Configuration changes go in `config.ts`
- New utility functions go in `utils.ts`
- Schema or prompt changes go in `schemas.ts`
- Processing logic changes go in `expert-advice-processor.ts`
- HTTP handling changes go in `index.ts`
