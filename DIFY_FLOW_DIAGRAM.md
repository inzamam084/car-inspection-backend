# Dify Workflow Integration - Visual Flow

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Triggers Inspection                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              runAnalysisInBackground(inspectionId)               │
│  • Updates status to "processing"                                │
│  • Fetches inspection data (photos, OBD2, title images)         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│          processImagesWithDifyWorkflow()                         │
│  • Processes ALL images concurrently                             │
│  • Applies retry logic to each image                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   ┌─────────┐         ┌─────────┐         ┌─────────┐
   │ Photo 1 │         │ Photo 2 │   ...   │ Photo N │
   └────┬────┘         └────┬────┘         └────┬────┘
        │                   │                    │
        │    ┌──────────────┼──────────────┐    │
        │    │              │              │    │
        ▼    ▼              ▼              ▼    ▼
   ┌─────────────────────────────────────────────────┐
   │        callDifyWorkflow() [with retries]        │
   │  • Builds request payload                       │
   │  • Sends to Dify API                            │
   │  • Handles streaming response                   │
   └──────────────────────┬──────────────────────────┘
                          │
                          ▼
   ┌─────────────────────────────────────────────────┐
   │            Dify Workflow API                    │
   │  POST /v1/workflows/run                         │
   │  {                                              │
   │    inputs: {                                    │
   │      image: [...],                              │
   │      inspection_id: "...",                      │
   │      user_id: "...",                            │
   │      image_id: "...",                           │
   │      image_type: "photo"                        │
   │    },                                           │
   │    response_mode: "streaming"                   │
   │  }                                              │
   └──────────────────────┬──────────────────────────┘
                          │
                          ▼
   ┌─────────────────────────────────────────────────┐
   │        Streaming Response (SSE Events)          │
   │  • workflow_started                             │
   │  • node_started                                 │
   │  • node_finished                                │
   │  • workflow_finished                            │
   └──────────────────────┬──────────────────────────┘
                          │
                          ▼
   ┌─────────────────────────────────────────────────┐
   │         Process & Store Results                 │
   │  • Extract workflow outputs                     │
   │  • Log success/failure                          │
   │  • Return to caller                             │
   └─────────────────────────────────────────────────┘
```

## Concurrent Processing Flow

```
Time →

t0:  [Photo1]  [Photo2]  [Photo3]  [OBD1]  [Title1]
      ↓         ↓         ↓         ↓        ↓
t1:  [Dify]   [Dify]   [Dify]   [Dify]   [Dify]   ← All sent simultaneously
      ↓         ↓         ↓         ↓        ↓
t2:   [Processing in parallel...]
      ↓         ↓         ↓         ↓        ↓
t3:  [Done]   [Done]   [Retry]  [Done]   [Done]   ← Results arrive
                        ↓
t4:                   [Dify]                       ← Retry with backoff
                        ↓
t5:                   [Done]                       ← Complete

Total Time: ~5 seconds (vs 25 seconds sequential)
```

## Retry Logic Flow

```
┌─────────────────────────────────────────┐
│     Call Dify Workflow (Attempt 1)      │
└────────────────┬────────────────────────┘
                 │
                 ▼
            ┌─────────┐
            │ Success?│
            └────┬────┘
                 │
        ┌────────┴────────┐
        │                 │
       YES               NO
        │                 │
        ▼                 ▼
   [Return]     ┌──────────────────┐
   [Result]     │ Is Retryable?    │
                │ (5xx, timeout,   │
                │  network error)  │
                └────┬─────────────┘
                     │
            ┌────────┴────────┐
            │                 │
           YES               NO
            │                 │
            ▼                 ▼
   ┌─────────────┐      [Throw]
   │ Wait 1s     │      [Error]
   └──────┬──────┘
          ▼
   ┌─────────────────────────────────────┐
   │   Retry (Attempt 2) - Wait 2s       │
   └────────────────┬────────────────────┘
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │   Retry (Attempt 3) - Wait 4s       │
   └────────────────┬────────────────────┘
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │   Final Attempt (Attempt 4)         │
   │   → Success or Final Failure        │
   └─────────────────────────────────────┘
```

## Error Handling & Fallback

```
┌─────────────────────────────────────────────────┐
│      processImagesWithDifyWorkflow()            │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
            ┌──────────────┐
            │   Success?   │
            └──────┬───────┘
                   │
         ┌─────────┴─────────┐
         │                   │
        YES                 NO
         │                   │
         ▼                   ▼
   ┌──────────┐     ┌────────────────────┐
   │ Complete │     │ Log Error & Try    │
   │ Analysis │     │ Fallback           │
   └──────────┘     └─────────┬──────────┘
                              │
                              ▼
              ┌────────────────────────────────┐
              │  categorizeImagesConcurrently()│
              │  (Existing categorization)     │
              └────────────┬───────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Success?   │
                    └──────┬───────┘
                           │
                  ┌────────┴────────┐
                  │                 │
                 YES               NO
                  │                 │
                  ▼                 ▼
           ┌──────────┐      ┌──────────┐
           │ Continue │      │   Mark   │
           │ Analysis │      │  Failed  │
           └──────────┘      └──────────┘
```

## Data Flow

```
┌─────────────┐
│  Database   │
│  (Postgres) │
└──────┬──────┘
       │
       │ Fetch inspection data
       │
       ▼
┌──────────────────────────────────────┐
│     Inspection Data                  │
│  • id: "550e8400-e29b..."           │
│  • photos: [...]                     │
│  • obd2_codes: [...]                │
│  • title_images: [...]              │
│  • type: "photo"                     │
│  • user_id: "user-123"              │
└──────┬───────────────────────────────┘
       │
       │ For each image
       │
       ▼
┌──────────────────────────────────────┐
│     Dify Request Payload             │
│  {                                   │
│    inputs: {                         │
│      image: [{                       │
│        type: "image",                │
│        transfer_method: "remote_url",│
│        url: "https://storage..."     │
│      }],                             │
│      inspection_id: "...",           │
│      user_id: "user-123",           │
│      image_id: "img-456",           │
│      image_type: "photo"             │
│    },                                │
│    response_mode: "streaming",       │
│    user: "user-123"                  │
│  }                                   │
└──────┬───────────────────────────────┘
       │
       │ HTTP POST
       │
       ▼
┌──────────────────────────────────────┐
│         Dify Workflow                │
│  • Receives image & metadata         │
│  • Runs AI analysis                  │
│  • Returns results via SSE           │
└──────┬───────────────────────────────┘
       │
       │ Streaming events
       │
       ▼
┌──────────────────────────────────────┐
│     Workflow Result                  │
│  {                                   │
│    id: "workflow-run-id",           │
│    status: "succeeded",              │
│    outputs: {                        │
│      analysis: "...",                │
│      category: "...",                │
│      confidence: 0.95                │
│    },                                │
│    elapsed_time: 2.5,                │
│    total_tokens: 1234                │
│  }                                   │
└──────┬───────────────────────────────┘
       │
       │ Store/Process
       │
       ▼
┌──────────────────────────────────────┐
│    Update Database                   │
│  • Save analysis results             │
│  • Update inspection status          │
│  • Log completion                    │
└──────────────────────────────────────┘
```

## Summary Statistics

```
Concurrent Processing Benefits:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Sequential:  [████████████████████] 25s (5 images × 5s)
Concurrent:  [████]                  5s (max of all)

Space Efficiency:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Streaming:   [██]                   Low memory
Non-Stream:  [████████████]         High memory

Retry Success Rate:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No Retry:    [████████]             80%
With Retry:  [███████████████████]  95%
```

## Environment Setup

```
┌──────────────────────────────┐
│   .env or Supabase Secrets   │
├──────────────────────────────┤
│ DIFY_API_URL                 │──┐
│ DIFY_API_KEY                 │  │
│ SUPABASE_URL                 │  │
│ SUPABASE_SERVICE_ROLE_KEY    │  │
└──────────────────────────────┘  │
                                   │
                                   │ Read at runtime
                                   │
                                   ▼
              ┌────────────────────────────────┐
              │      Edge Function             │
              │  (run-inspection)              │
              │                                │
              │  • config.ts reads env vars   │
              │  • processor.ts uses config   │
              └────────────────────────────────┘
```
