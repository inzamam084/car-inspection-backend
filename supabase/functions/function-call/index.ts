
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DIFY_API_ENDPOINT } from "./const.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Logging configuration
const LOG_TAG = 'FUNCTION_CALL';
const MAX_LOG_SIZE = 10000; // Maximum characters for request/response bodies in logs
const ENABLE_DETAILED_LOGGING = true; // Set to false in production if needed

// Logging utility functions
function generateRequestId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 900000) + 100000;
  return `req_${timestamp}_${random}`;
}

function truncateIfNeeded(text: string): string {
  if (text.length <= MAX_LOG_SIZE) return text;
  return `${text.substring(0, MAX_LOG_SIZE)}... [truncated, ${text.length - MAX_LOG_SIZE} more characters]`;
}

function sanitizeForLogging(data: any): any {
  if (!data) return data;
  
  const sanitized = JSON.parse(JSON.stringify(data));
  
  // Remove sensitive fields
  const sensitiveFields = ['api_key', 'password', 'token', 'authorization'];
  
  function recursiveSanitize(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    
    for (const key in obj) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        obj[key] = recursiveSanitize(obj[key]);
      }
    }
    return obj;
  }
  
  return recursiveSanitize(sanitized);
}

function logInfo(requestId: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}` : '';
  console.log(`[${LOG_TAG}] [${timestamp}] [${requestId}] INFO: ${message}${logData}`);
}

function logError(requestId: string, message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  const errorData = error ? ` | Error: ${truncateIfNeeded(JSON.stringify(error))}` : '';
  console.error(`[${LOG_TAG}] [${timestamp}] [${requestId}] ERROR: ${message}${errorData}`);
}

function logWarning(requestId: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}` : '';
  console.warn(`[${LOG_TAG}] [${timestamp}] [${requestId}] WARN: ${message}${logData}`);
}

function logDebug(requestId: string, message: string, data?: any): void {
  if (!ENABLE_DETAILED_LOGGING) return;
  const timestamp = new Date().toISOString();
  const logData = data ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}` : '';
  console.log(`[${LOG_TAG}] [${timestamp}] [${requestId}] DEBUG: ${message}${logData}`);
}

// Define the response interface for the Dify API
interface DifyResponse {
  id: string
  answer: string
  created_at: number
  conversation_id?: string
  task_id?: string
  message_id?: string
  event?: string
  mode?: string
  metadata?: {
    usage?: {
      completion_tokens: number
      prompt_tokens: number
      total_tokens: number
      total_price?: string
      currency?: string
      latency?: number
      prompt_unit_price?: string
      prompt_price_unit?: string
      prompt_price?: string
      completion_unit_price?: string
      completion_price_unit?: string
      completion_price?: string
    }
  }
}

// @ts-ignore: Deno global is available in Supabase Edge Functions
Deno.serve(async (req) => {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const requestId = generateRequestId();
  let userId: string | null = null;
  let functionName: string | null = null;
  let requestData: any = null;
  let errorMessage: string | null = null;

  logInfo(requestId, 'Function call started', { url: req.url, method: req.method });

  try {
    const body = await req.json();
    const {function_name, user_id, ...rest} = body;
    
    logDebug(requestId, 'Request body parsed', { function_name, user_id, inputs_count: Object.keys(rest).length });
    
    functionName = function_name;
    requestData = {
      inputs: rest,
      user: "abc-123",
      response_mode: 'blocking'
    };

    // Get user_id from function params or JWT token
    userId = user_id || null;
    if (!userId) {
      logDebug(requestId, 'Attempting to extract user from JWT token');
      try {
        const authHeader = req.headers.get('Authorization');
        if (authHeader) {
          const token = authHeader.replace('Bearer ', '');
          // Create a temporary supabase client to get user from JWT
          const tempSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
          const { data: { user } } = await tempSupabase.auth.getUser(token);
          userId = user?.id || null;
          logDebug(requestId, 'User extracted from JWT', { userId: userId ? '[PRESENT]' : '[MISSING]' });
        } else {
          logWarning(requestId, 'No Authorization header found');
        }
      } catch (authError) {
        logWarning(requestId, 'Could not extract user from JWT', authError);
      }
    } else {
      logDebug(requestId, 'User ID provided in request', { userId: '[PRESENT]' });
    }
    
    if (!function_name) {
      errorMessage = 'function_name parameter is required';
      logError(requestId, 'Missing required parameter: function_name');
      
      // Log error to database
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const endTime = Date.now();
      const endedAt = new Date().toISOString();
      const executionTime = (endTime - startTime) / 1000;
      
      await logActivity(supabase, {
        user_id: userId,
        function_name: functionName,
        request_data: requestData,
        error: errorMessage,
        started_at: startedAt,
        ended_at: endedAt,
        execution_time: executionTime
      });
      
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    logInfo(requestId, 'Processing function call', { function_name, userId: userId ? '[PRESENT]' : '[MISSING]' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    // Fetch the Dify API key from the database
    logDebug(requestId, 'Fetching function mapping from database', { function_name });
    const { data: mappingData, error: mappingError } = await supabase
      .from('dify_function_mapping')
      .select('*')
      .eq('function_name', function_name)
      .single()
    
    if (mappingError || !mappingData) {
      errorMessage = `Failed to retrieve function mapping: ${mappingError?.message || 'No mapping found'}`;
      logError(requestId, 'Function mapping retrieval failed', { function_name, error: mappingError });
      
      // Log error to database
      const endTime = Date.now();
      const endedAt = new Date().toISOString();
      const executionTime = (endTime - startTime) / 1000;
      
      await logActivity(supabase, {
        user_id: userId,
        function_name: functionName,
        request_data: requestData,
        error: errorMessage,
        started_at: startedAt,
        ended_at: endedAt,
        execution_time: executionTime
      });
      
      return new Response(
        JSON.stringify({ error: 'Failed to retrieve function mapping', details: mappingError }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    logInfo(requestId, 'Function mapping retrieved successfully', { 
      function_name, 
      type: mappingData.type,
      has_api_key: !!mappingData.api_key 
    });

    const path = mappingData.type === 'completion' ? 'completion-messages' : 'workflow'
    const difyUrl = `${DIFY_API_ENDPOINT}/${path}`;
    
    logDebug(requestId, 'Making request to Dify API', { 
      url: difyUrl, 
      type: mappingData.type,
      inputs_count: Object.keys(rest).length 
    });
    
    const response = await fetch(difyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mappingData.api_key}`
      },
      body: JSON.stringify({
        inputs: rest,
        user: "abc-123",
        response_mode: 'blocking',
      })
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      errorMessage = `Dify API request failed: ${response.status} - ${errorText}`;
      logError(requestId, 'Dify API request failed', { 
        status: response.status, 
        statusText: response.statusText,
        url: difyUrl,
        errorText: truncateIfNeeded(errorText)
      });
      
      // Log error to database
      const endTime = Date.now();
      const endedAt = new Date().toISOString();
      const executionTime = (endTime - startTime) / 1000;
      
      await logActivity(supabase, {
        user_id: userId,
        function_name: functionName,
        request_data: requestData,
        error: errorMessage,
        started_at: startedAt,
        ended_at: endedAt,
        execution_time: executionTime
      });
      
      return new Response(
        JSON.stringify({ error: 'Dify API request failed', status: response.status, details: errorText }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    const difyResponse: DifyResponse = await response.json()
    
    logInfo(requestId, 'Dify API response received successfully', {
      response_id: difyResponse.id,
      task_id: difyResponse.task_id,
      message_id: difyResponse.message_id,
      event: difyResponse.event,
      mode: difyResponse.mode,
      answer_length: difyResponse.answer?.length || 0,
      has_usage_data: !!difyResponse.metadata?.usage
    });
    
    if (difyResponse.metadata?.usage) {
      logDebug(requestId, 'Usage metrics', {
        prompt_tokens: difyResponse.metadata.usage.prompt_tokens,
        completion_tokens: difyResponse.metadata.usage.completion_tokens,
        total_tokens: difyResponse.metadata.usage.total_tokens,
        total_price: difyResponse.metadata.usage.total_price,
        currency: difyResponse.metadata.usage.currency,
        latency: difyResponse.metadata.usage.latency
      });
    }
    
    // Log successful request and response to ai_activity_logs table
    const endTime = Date.now();
    const endedAt = new Date().toISOString();
    const executionTime = (endTime - startTime) / 1000;
    const calculatedLatency = executionTime;
    
    logDebug(requestId, 'Logging activity to database', { execution_time: executionTime });
    
    await logActivity(supabase, {
      user_id: userId,
      task_id: difyResponse.task_id || null,
      message_id: difyResponse.message_id || difyResponse.id || null,
      event: difyResponse.event || 'message',
      mode: difyResponse.mode || mappingData.type || 'completion',
      function_name: functionName,
      request_data: requestData,
      response_data: difyResponse,
      answer: difyResponse.answer || null,
      prompt_tokens: difyResponse.metadata?.usage?.prompt_tokens || null,
      prompt_unit_price: difyResponse.metadata?.usage?.prompt_unit_price || null,
      prompt_price_unit: difyResponse.metadata?.usage?.prompt_price_unit || null,
      prompt_price: difyResponse.metadata?.usage?.prompt_price || null,
      completion_tokens: difyResponse.metadata?.usage?.completion_tokens || null,
      completion_unit_price: difyResponse.metadata?.usage?.completion_unit_price || null,
      completion_price_unit: difyResponse.metadata?.usage?.completion_price_unit || null,
      completion_price: difyResponse.metadata?.usage?.completion_price || null,
      total_tokens: difyResponse.metadata?.usage?.total_tokens || null,
      total_price: difyResponse.metadata?.usage?.total_price || null,
      currency: difyResponse.metadata?.usage?.currency || 'USD',
      latency: difyResponse.metadata?.usage?.latency || calculatedLatency,
      started_at: startedAt,
      ended_at: endedAt,
      execution_time: executionTime
    });
    
    logInfo(requestId, 'Function call completed successfully', { 
      execution_time: executionTime,
      answer_length: difyResponse.answer?.length || 0
    });
    
    // Return the Dify API response
    return new Response(
      JSON.stringify({
        success: true,
        payload: difyResponse.answer,
        metadata: difyResponse.metadata
      }),
      { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' }
      }
    )
    
  } catch (error) {
    errorMessage = `Internal server error: ${error.message}`;
    logError(requestId, 'Unhandled error in function execution', { 
      error: error.message, 
      stack: error.stack 
    });
    
    // Log error to database
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const endTime = Date.now();
    const endedAt = new Date().toISOString();
    const executionTime = (endTime - startTime) / 1000;
    
    await logActivity(supabase, {
      user_id: userId,
      function_name: functionName,
      request_data: requestData,
      error: errorMessage,
      started_at: startedAt,
      ended_at: endedAt,
      execution_time: executionTime
    });
    
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

// Helper function to log activity with error handling
async function logActivity(supabase: any, data: any) {
  const requestId = generateRequestId();
  
  try {
    logDebug(requestId, 'Preparing activity log data', {
      has_user_id: !!data.user_id,
      has_function_name: !!data.function_name,
      has_error: !!data.error,
      execution_time: data.execution_time
    });

    const logData = {
      user_id: data.user_id || null,
      task_id: data.task_id || null,
      message_id: data.message_id || null,
      event: data.event || 'message',
      mode: data.mode || 'completion',
      function_name: data.function_name || 'unknown',
      request_data: data.request_data || null,
      response_data: data.response_data || null,
      answer: data.answer || null,
      prompt_tokens: data.prompt_tokens || null,
      prompt_unit_price: data.prompt_unit_price || null,
      prompt_price_unit: data.prompt_price_unit || null,
      prompt_price: data.prompt_price || null,
      completion_tokens: data.completion_tokens || null,
      completion_unit_price: data.completion_unit_price || null,
      completion_price_unit: data.completion_price_unit || null,
      completion_price: data.completion_price || null,
      total_tokens: data.total_tokens || null,
      total_price: data.total_price || null,
      currency: data.currency || 'USD',
      latency: data.latency || null,
      error: data.error || null,
      started_at: data.started_at || null,
      ended_at: data.ended_at || null,
      execution_time: data.execution_time || null
    };

    logDebug(requestId, 'Inserting activity log into database', {
      table: 'ai_activity_logs',
      function_name: logData.function_name,
      has_error: !!logData.error
    });

    const { error: logError } = await supabase
      .from('ai_activity_logs')
      .insert(logData);

    if (logError) {
      logError(requestId, 'Failed to insert activity log', {
        error: logError.message,
        code: logError.code,
        details: logError.details
      });
    } else {
      logDebug(requestId, 'Activity log inserted successfully', {
        function_name: logData.function_name,
        execution_time: logData.execution_time
      });
    }
  } catch (logError) {
    logError(requestId, 'Exception in logging process', {
      error: logError.message,
      stack: logError.stack
    });
  }
}
