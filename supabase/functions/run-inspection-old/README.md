# Run Inspection Function

This function handles the initial processing of car inspection requests, managing both direct photo uploads and URL-based scraping workflows.

## Overview

The `run-inspection` function serves as the entry point for processing car inspections. It receives webhook payloads containing inspection IDs and orchestrates the analysis pipeline by creating processing jobs and triggering background analysis.

## Architecture

The function is organized into multiple modules:

- **`index.ts`** - Main entry point with the serve function
- **`config.ts`** - Configuration constants and client initialization
- **`schemas.ts`** - TypeScript interfaces and type definitions
- **`utils.ts`** - Utility functions for HEIC conversion and chunking
- **`run-inspection-processor.ts`** - Main processing logic
- **`README.md`** - This documentation file

## Key Features

### 1. Dual Processing Modes
- **Direct Upload Mode**: Processes inspections with directly uploaded photos
- **URL Scraping Mode**: First scrapes images from provided URLs, then processes

### 2. HEIC Image Conversion
- Automatically detects HEIC format images
- Converts HEIC to JPEG using Cloudinary
- Updates database with converted image paths

### 3. Intelligent Image Chunking
- Groups images by category priority
- Respects size limits (20MB default)
- Creates optimized chunks for processing

### 4. Queue-Based Processing
- Creates processing jobs for each chunk
- Manages job sequencing and dependencies
- Supports multiple job types (chunk analysis, cost forecast, market value, expert advice)

## Configuration

Key environment variables:
- `OPENAI_API_KEY` - OpenAI API key for analysis
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `APP_BASE_URL` - Base URL for the application
- `MAX_CHUNK_SIZE` - Maximum chunk size in bytes (default: 20MB)

## Processing Flow

1. **Webhook Reception**: Receives inspection ID from webhook payload
2. **Validation**: Verifies inspection exists and fetches details
3. **Pipeline Selection**: Chooses between direct processing or scrape-then-process
4. **Data Fetching**: Retrieves photos, OBD2 codes, and title images
5. **Chunking**: Creates category-based chunks within size limits
6. **Job Creation**: Creates processing jobs for each chunk and additional analyses
7. **Queue Triggering**: Initiates the first processing job
8. **Response**: Returns immediate success response while processing continues

## Job Types

- **`chunk_analysis`** - Analyzes image chunks for defects and issues
- **`ownership_cost_forecast`** - Generates ownership cost predictions
- **`fair_market_value`** - Determines fair market value
- **`expert_advice`** - Provides expert recommendations

## Category Priority

Images are processed in this order of priority:
1. exterior
2. interior
3. dashboard
4. paint
5. rust
6. engine
7. undercarriage
8. obd
9. title
10. records

## Error Handling

- Comprehensive error logging
- Automatic status updates to "failed" on errors
- Graceful fallbacks for missing data
- HEIC conversion error handling

## Dependencies

- Supabase client for database operations
- OpenAI client for AI analysis
- Cloudinary for image conversion
- Standard Deno HTTP server

## Usage

This function is typically triggered by webhooks from the frontend application when a new inspection is submitted. It handles the orchestration of the entire analysis pipeline without blocking the initial response.
