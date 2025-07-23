# Step Logs Usage Examples

This document provides examples of how to use the `step_logs` table and its helper functions for dynamic logging across multiple processing steps.

## Table Schema Overview

The `step_logs` table provides a flexible, dynamic schema for logging multiple processing steps with the following key features:

- **Dynamic JSON storage** in `details` and `metadata` columns
- **Hierarchical logging** with parent-child relationships
- **Automatic sequencing** for proper log ordering
- **Performance tracking** with duration, tokens, and cost metrics
- **Flexible categorization** with tags and step types
- **Row Level Security** for user data protection

## Basic Usage Examples

### 1. Simple Step Logging

```sql
-- Log the start of image analysis
SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_step_name := 'image_analysis',
    p_step_type := 'start',
    p_message := 'Starting image analysis for 15 photos',
    p_details := jsonb_build_object(
        'total_photos', 15,
        'photo_categories', ARRAY['exterior', 'interior', 'engine']
    ),
    p_tags := ARRAY['processing', 'images']
);

-- Log successful completion
SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_step_name := 'image_analysis',
    p_step_type := 'success',
    p_message := 'Image analysis completed successfully',
    p_details := jsonb_build_object(
        'processed_photos', 15,
        'detected_issues', 3,
        'confidence_score', 0.92
    ),
    p_duration_ms := 45000,
    p_tokens_used := 2500,
    p_cost_usd := 0.05,
    p_model_used := 'gpt-4-vision-preview'
);
```

### 2. Market Research Step with Detailed Data

```sql
-- Log market research step
SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_step_name := 'market_research',
    p_step_type := 'success',
    p_message := 'Market value research completed',
    p_details := jsonb_build_object(
        'vehicle_info', jsonb_build_object(
            'make', 'Toyota',
            'model', 'Camry',
            'year', 2020,
            'mileage', 45000
        ),
        'market_data', jsonb_build_object(
            'average_price', 22500,
            'price_range', jsonb_build_object(
                'min', 19000,
                'max', 26000
            ),
            'market_trend', 'stable',
            'data_sources', ARRAY['KBB', 'Edmunds', 'AutoTrader']
        ),
        'comparable_listings', jsonb_build_array(
            jsonb_build_object('price', 21500, 'mileage', 42000, 'location', 'nearby'),
            jsonb_build_object('price', 23000, 'mileage', 48000, 'location', 'regional')
        )
    ),
    p_metadata := jsonb_build_object(
        'api_calls_made', 5,
        'cache_hits', 2,
        'data_freshness', 'current'
    ),
    p_duration_ms := 12000,
    p_tokens_used := 800,
    p_cost_usd := 0.02,
    p_tags := ARRAY['market_research', 'pricing', 'external_api']
);
```

### 3. Error Logging with Retry Logic

```sql
-- Log an error with retry information
SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_step_name := 'expert_advice',
    p_step_type := 'error',
    p_message := 'API rate limit exceeded, will retry',
    p_details := jsonb_build_object(
        'error_type', 'rate_limit',
        'api_endpoint', '/expert-analysis',
        'rate_limit_reset', '2025-07-14T18:45:00Z'
    ),
    p_error_code := 'RATE_LIMIT_429',
    p_retry_count := 1,
    p_tags := ARRAY['error', 'rate_limit', 'retry']
);

-- Log successful retry
SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_step_name := 'expert_advice',
    p_step_type := 'success',
    p_message := 'Expert advice generated after retry',
    p_details := jsonb_build_object(
        'advice_categories', ARRAY['maintenance', 'safety', 'value'],
        'recommendations', jsonb_build_array(
            jsonb_build_object(
                'category', 'maintenance',
                'priority', 'high',
                'description', 'Replace brake pads within 1000 miles',
                'estimated_cost', 300
            ),
            jsonb_build_object(
                'category', 'safety',
                'priority', 'medium',
                'description', 'Check tire tread depth',
                'estimated_cost', 0
            )
        )
    ),
    p_duration_ms := 8000,
    p_tokens_used := 1200,
    p_cost_usd := 0.03,
    p_retry_count := 1,
    p_tags := ARRAY['expert_advice', 'retry_success']
);
```

### 4. Cost Forecasting with Complex Data

```sql
-- Log cost forecasting step
SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_step_name := 'cost_forecasting',
    p_step_type := 'success',
    p_message := '5-year ownership cost forecast completed',
    p_details := jsonb_build_object(
        'forecast_period_years', 5,
        'annual_costs', jsonb_build_object(
            'year_1', jsonb_build_object(
                'maintenance', 800,
                'repairs', 200,
                'insurance', 1200,
                'fuel', 1500,
                'total', 3700
            ),
            'year_2', jsonb_build_object(
                'maintenance', 1000,
                'repairs', 400,
                'insurance', 1250,
                'fuel', 1550,
                'total', 4200
            )
        ),
        'total_5_year_cost', 22500,
        'depreciation', jsonb_build_object(
            'current_value', 22500,
            'year_5_value', 12000,
            'total_depreciation', 10500
        ),
        'assumptions', jsonb_build_object(
            'annual_mileage', 12000,
            'fuel_price_per_gallon', 3.50,
            'inflation_rate', 0.03
        )
    ),
    p_metadata := jsonb_build_object(
        'model_version', 'v2.1',
        'confidence_level', 0.85,
        'data_sources', ARRAY['historical_data', 'market_trends', 'manufacturer_data']
    ),
    p_duration_ms := 15000,
    p_tokens_used := 1800,
    p_cost_usd := 0.04,
    p_tags := ARRAY['cost_forecasting', 'financial_analysis']
);
```

### 5. Hierarchical Logging (Parent-Child Relationships)

```sql
-- Log parent step
SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_step_name := 'final_report_generation',
    p_step_type := 'start',
    p_message := 'Starting final report compilation',
    p_details := jsonb_build_object(
        'report_sections', ARRAY['summary', 'detailed_analysis', 'recommendations', 'cost_forecast']
    )
) AS parent_log_id \gset

-- Log child steps
SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_step_name := 'report_section_summary',
    p_step_type := 'success',
    p_message := 'Summary section generated',
    p_parent_log_id := :'parent_log_id',
    p_duration_ms := 3000,
    p_tokens_used := 500
);

SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_step_name := 'report_section_analysis',
    p_step_type := 'success',
    p_message := 'Detailed analysis section generated',
    p_parent_log_id := :'parent_log_id',
    p_duration_ms := 5000,
    p_tokens_used := 1200
);
```

## Querying Examples

### 1. Get All Logs for an Inspection (Ordered)

```sql
SELECT 
    step_name,
    step_type,
    message,
    duration_ms,
    tokens_used,
    cost_usd,
    created_at
FROM step_logs 
WHERE inspection_id = '123e4567-e89b-12d3-a456-426614174000'
ORDER BY sequence_order, sub_step_order;
```

### 2. Get Logs Summary Using Helper Function

```sql
SELECT * FROM get_inspection_logs_summary('123e4567-e89b-12d3-a456-426614174000');
```

### 3. Find All Errors Across Inspections

```sql
SELECT 
    inspection_id,
    step_name,
    message,
    error_code,
    details,
    created_at
FROM step_logs 
WHERE step_type = 'error'
ORDER BY created_at DESC;
```

### 4. Get Performance Metrics by Step

```sql
SELECT 
    step_name,
    COUNT(*) as execution_count,
    AVG(duration_ms) as avg_duration_ms,
    SUM(tokens_used) as total_tokens,
    SUM(cost_usd) as total_cost,
    COUNT(*) FILTER (WHERE step_type = 'error') as error_count
FROM step_logs 
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY step_name
ORDER BY total_cost DESC;
```

### 5. Search Logs by Tags

```sql
SELECT 
    inspection_id,
    step_name,
    message,
    tags,
    created_at
FROM step_logs 
WHERE tags && ARRAY['error', 'retry']  -- Contains any of these tags
ORDER BY created_at DESC;
```

### 6. Get Detailed Market Research Data

```sql
SELECT 
    inspection_id,
    details->'vehicle_info' as vehicle_info,
    details->'market_data'->'average_price' as average_price,
    details->'market_data'->'price_range' as price_range,
    details->'comparable_listings' as comparable_listings
FROM step_logs 
WHERE step_name = 'market_research' 
AND step_type = 'success';
```

### 7. Monitor Processing Performance

```sql
-- Get processing times by step for recent inspections
SELECT 
    step_name,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) as median_duration_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration_ms,
    AVG(duration_ms) as avg_duration_ms,
    COUNT(*) as sample_size
FROM step_logs 
WHERE created_at >= NOW() - INTERVAL '24 hours'
AND duration_ms IS NOT NULL
GROUP BY step_name
ORDER BY median_duration_ms DESC;
```

## Integration with Processing Jobs

```sql
-- Log step with job reference
SELECT log_step(
    p_inspection_id := '123e4567-e89b-12d3-a456-426614174000',
    p_job_id := 'job-uuid-here',
    p_step_name := 'chunk_processing',
    p_step_type := 'progress',
    p_message := 'Processing chunk 3 of 5',
    p_details := jsonb_build_object(
        'chunk_index', 3,
        'total_chunks', 5,
        'images_in_chunk', ARRAY['img1.jpg', 'img2.jpg', 'img3.jpg']
    )
);
```

## Best Practices

1. **Use consistent step names** across your application
2. **Include relevant metadata** for debugging and monitoring
3. **Use appropriate step types** (start, progress, success, error, warning, info)
4. **Add meaningful tags** for easy filtering and categorization
5. **Include performance metrics** (duration, tokens, cost) when available
6. **Use hierarchical logging** for complex multi-step processes
7. **Store structured data** in the details JSON field for easy querying
8. **Include error codes** for standardized error handling

This logging system provides comprehensive tracking of your multi-step processing pipeline with the flexibility to adapt to different step requirements and data structures.
