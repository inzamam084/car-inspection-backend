# Process Next Chunk Function

This function has been refactored and modularized for better scalability, maintainability, and optimization.

## Architecture Overview

The function is now split into multiple focused modules:

### Core Files

- **`index.ts`** - Main entry point and HTTP request handler
- **`chunk-processor.ts`** - Core business logic for processing inspections
- **`config.ts`** - Configuration constants and client initialization
- **`schemas.ts`** - TypeScript interfaces and type definitions
- **`utils.ts`** - Utility functions for common operations
- **`prompts.ts`** - AI prompt templates
- **`vehicle-report-schema.ts`** - Gemini API schema definitions

## Key Improvements

### 1. **Modular Architecture**
- Separated concerns into focused modules
- Clear separation between configuration, business logic, and utilities
- Easier to test and maintain individual components

### 2. **Type Safety**
- Comprehensive TypeScript interfaces
- Strong typing for all data structures
- Better IDE support and error catching

### 3. **Configuration Management**
- Centralized configuration in `config.ts`
- Environment variable management
- Easy to modify settings without touching business logic

### 4. **Error Handling**
- Structured error types with context
- Better error logging and debugging
- Graceful error recovery

### 5. **Performance Optimizations**
- Configurable concurrency for image uploads
- Rate limiting and batch processing
- Efficient memory usage

## Function Flow

```
1. Request received in index.ts
2. Payload validation and parsing
3. Background processing initiated via chunk-processor.ts
4. Inspection data fetched from database
5. Images uploaded to Gemini API in batches
6. Gemini request body constructed
7. Dify workflow initiated with streaming response handling
8. Database updated with workflow status
```

## Configuration

Key configuration options in `config.ts`:

```typescript
// Processing Configuration
export const PROCESSING_CONFIG = {
  maxConcurrentUploads: 3,     // Concurrent image uploads
  batchDelayMs: 2000,          // Delay between batches
  rateLimitDelayMs: 1000,      // Rate limiting delay
}
```

## API Integration

### Gemini API
- Handles image uploads with resumable upload protocol
- Structured output with schema validation
- Batch processing with concurrency control

### Dify Workflow API
- Streaming response handling
- Comprehensive event logging
- Automatic workflow status tracking

## Error Handling

The function includes comprehensive error handling:

- **Validation Errors**: Missing required parameters
- **Upload Errors**: Failed image uploads to Gemini
- **API Errors**: Dify workflow API failures
- **Database Errors**: Supabase query failures

## Monitoring and Logging

Detailed logging for:
- Processing stages and progress
- API interactions and responses
- Error conditions and debugging
- Performance metrics

## Usage

The function accepts a POST request with:

```json
{
  "inspection_id": "string",
  "completed_sequence": "number (optional)"
}
```

Returns immediate response while processing continues in background:

```json
{
  "message": "Processing started for inspection",
  "inspectionId": "string"
}
```

## Development

### Adding New Features
1. Add types to `schemas.ts`
2. Add configuration to `config.ts` if needed
3. Implement logic in appropriate module
4. Update this README

### Testing
- Each module can be tested independently
- Mock external dependencies using the interfaces
- Test error conditions and edge cases

### Deployment
- All files must be deployed together
- Environment variables must be configured
- Database schema must be compatible

## Dependencies

- **Supabase**: Database and storage
- **Gemini API**: AI analysis and image processing
- **Dify API**: Workflow orchestration
- **Deno**: Runtime environment

## Environment Variables

Required environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `DIFY_WORKFLOW_API_KEY`

## Future Enhancements

Potential improvements:
- Add retry mechanisms for failed uploads
- Implement file cleanup for Gemini uploads
- Add metrics collection and monitoring
- Implement caching for repeated requests
- Add support for different AI models
