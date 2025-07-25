# Extension Integration Usage Guide

This document explains how to use the car inspection backend with browser extension data from Copart and other vehicle auction sites.

## Overview

The `run-inspection` function now supports two types of data input:

1. **Webhook Payload** (existing): For inspections already created in the database
2. **Extension Payload** (new): For vehicle data scraped from auction sites

## Extension Data Format

The extension should send data in the following format:

```json
{
  "vehicleData": {
    "description": "Copart vehicle - 13 images extracted",
    "gallery_images": [
      "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0725/0034d2f57df440a6b1823beee162d80a_ful.jpg",
      "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0725/169b5042a72a41c18c3469701ac055ed_ful.jpg",
      // ... more image URLs
    ],
    "listing_url": "https://www.copart.com/lot/62947865/clean-title-2016-bmw-x1-xdrive28i-nb-moncton",
    "make": "BMW",
    "mileage": "0",
    "model": "X1 XDRIVE28I",
    "price": "0",
    "scraped_at": "2025-07-25T04:35:27.242Z",
    "seller_name": "Copart",
    "seller_phone": "",
    "thumbnail_url": "",
    "vin": "LOT-62947865",
    "year": 2016,
    "email": "user@example.com" // Optional: user email for the inspection
  }
}
```

## API Endpoint

**URL**: `https://your-supabase-url.supabase.co/functions/v1/run-inspection`

**Method**: `POST`

**Headers**:
```
Content-Type: application/json
Authorization: Bearer YOUR_SUPABASE_ANON_KEY
```

## Processing Flow

When extension data is received, the system:

1. **Creates Inspection Record**: Creates a new inspection in the database with:
   - VIN from the vehicle data
   - Mileage information
   - Listing URL
   - Type marked as "extension"
   - Email (if provided, defaults to "extension@copart.com")

2. **Downloads Images**: Downloads all images from the `gallery_images` array with:
   - Retry logic for failed downloads
   - Proper user agents and referers for different auction sites
   - Rate limiting between downloads

3. **AI Categorization**: Each image is analyzed using OpenAI GPT-4o-mini to categorize into:
   - `exterior`: Outside views, body panels, paint, wheels, etc.
   - `interior`: Cabin views, seats, upholstery, trim, etc.
   - `dashboard`: Dashboard, controls, gauges, steering wheel, etc.
   - `engine`: Engine bay, mechanical components, etc.
   - `undercarriage`: Underneath views, chassis, suspension, etc.

4. **Storage**: Images are uploaded to Supabase Storage with:
   - Organized folder structure by inspection ID
   - Categorized filenames
   - Metadata stored in database

5. **Analysis Pipeline**: Triggers the full inspection analysis including:
   - Defect detection and assessment
   - Ownership cost forecasting
   - Fair market value estimation
   - Expert advice generation

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "Extension data processed successfully",
  "inspectionId": "uuid-of-created-inspection",
  "status": "processing"
}
```

### Error Response
```json
{
  "error": "Error message describing what went wrong"
}
```

## Example Usage

### Browser Extension Background Script
**Important**: The API request should be made from the background script of your browser extension, not from content scripts, to avoid CORS issues and ensure proper authentication.

```javascript
// background.js or service-worker.js
const vehicleData = {
  description: "Copart vehicle - 13 images extracted",
  gallery_images: [
    "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0725/0034d2f57df440a6b1823beee162d80a_ful.jpg",
    // ... more URLs
  ],
  listing_url: "https://www.copart.com/lot/62947865/clean-title-2016-bmw-x1-xdrive28i-nb-moncton",
  make: "BMW",
  model: "X1 XDRIVE28I",
  year: 2016,
  vin: "LOT-62947865",
  mileage: "0",
  price: "0",
  seller_name: "Copart",
  scraped_at: new Date().toISOString(),
  email: "user@example.com"
};

// Make the API call from background script
const response = await fetch('https://your-supabase-url.supabase.co/functions/v1/run-inspection', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_SUPABASE_ANON_KEY'
  },
  body: JSON.stringify({ vehicleData })
});

const result = await response.json();
console.log('Inspection created:', result.inspectionId);

// Optionally notify content script or popup about the result
chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
  chrome.tabs.sendMessage(tabs[0].id, {
    action: 'inspectionCreated',
    inspectionId: result.inspectionId,
    status: result.status
  });
});
```

### Content Script Integration
If you need to trigger the inspection from a content script, send a message to the background script:

```javascript
// content-script.js
function sendVehicleDataToBackground(vehicleData) {
  chrome.runtime.sendMessage({
    action: 'createInspection',
    vehicleData: vehicleData
  }, function(response) {
    console.log('Inspection request sent:', response);
  });
}

// background.js - handle messages from content script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'createInspection') {
    // Make the API call here
    fetch('https://your-supabase-url.supabase.co/functions/v1/run-inspection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_SUPABASE_ANON_KEY'
      },
      body: JSON.stringify({ vehicleData: request.vehicleData })
    })
    .then(response => response.json())
    .then(result => {
      sendResponse({ success: true, result: result });
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Keep message channel open for async response
  }
});
```

### cURL Example
```bash
curl -X POST \
  https://your-supabase-url.supabase.co/functions/v1/run-inspection \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_SUPABASE_ANON_KEY' \
  -d '{
    "vehicleData": {
      "description": "Copart vehicle - 13 images extracted",
      "gallery_images": [
        "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0725/0034d2f57df440a6b1823beee162d80a_ful.jpg"
      ],
      "listing_url": "https://www.copart.com/lot/62947865/clean-title-2016-bmw-x1-xdrive28i-nb-moncton",
      "make": "BMW",
      "model": "X1 XDRIVE28I",
      "year": 2016,
      "vin": "LOT-62947865",
      "mileage": "0",
      "price": "0",
      "seller_name": "Copart",
      "scraped_at": "2025-07-25T04:35:27.242Z",
      "email": "user@example.com"
    }
  }'
```

## Supported Auction Sites

The image downloader includes proper referers for:
- Copart
- Craigslist
- ABetter Bid
- AutoBidMaster
- Capital Auto Auction
- SalvageBid

## Error Handling

The system includes comprehensive error handling for:
- Invalid JSON payloads
- Missing required fields
- Image download failures
- AI categorization errors
- Database insertion errors
- Storage upload failures

## Monitoring

Processing progress is logged with detailed information:
- Batch processing status
- Individual image download progress
- AI categorization results
- Upload success/failure rates
- Final processing summary

## Rate Limiting

The system implements intelligent rate limiting:
- 1.5-2.5 second delays between images in a batch
- 3-5 second delays between batches
- Retry logic with exponential backoff for failed downloads

## Database Schema

The extension creates records in:
- `inspections`: Main inspection record
- `photos`: Individual image records with categories and storage info

Additional vehicle metadata (make, model, year, price, seller info) is logged but not currently stored in separate tables. This can be extended as needed.
