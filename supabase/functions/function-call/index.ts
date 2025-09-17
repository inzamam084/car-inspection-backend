import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DIFY_API_ENDPOINT } from "./const.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Logging configuration
const LOG_TAG = "FUNCTION_CALL";
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
  return `${text.substring(0, MAX_LOG_SIZE)}... [truncated, ${
    text.length - MAX_LOG_SIZE
  } more characters]`;
}

function sanitizeForLogging(data: any): any {
  if (!data) return data;

  const sanitized = JSON.parse(JSON.stringify(data));

  // Remove sensitive fields
  const sensitiveFields = ["api_key", "password", "token", "authorization"];

  function recursiveSanitize(obj: any): any {
    if (typeof obj !== "object" || obj === null) return obj;

    for (const key in obj) {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
        obj[key] = "[REDACTED]";
      } else if (typeof obj[key] === "object") {
        obj[key] = recursiveSanitize(obj[key]);
      }
    }
    return obj;
  }

  return recursiveSanitize(sanitized);
}

function logInfo(requestId: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logData = data
    ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}`
    : "";
  console.log(
    `[${LOG_TAG}] [${timestamp}] [${requestId}] INFO: ${message}${logData}`
  );
}

function logError(requestId: string, message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  const errorData = error
    ? ` | Error: ${truncateIfNeeded(JSON.stringify(error))}`
    : "";
  console.error(
    `[${LOG_TAG}] [${timestamp}] [${requestId}] ERROR: ${message}${errorData}`
  );
}

function logWarning(requestId: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logData = data
    ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}`
    : "";
  console.warn(
    `[${LOG_TAG}] [${timestamp}] [${requestId}] WARN: ${message}${logData}`
  );
}

function logDebug(requestId: string, message: string, data?: any): void {
  if (!ENABLE_DETAILED_LOGGING) return;
  const timestamp = new Date().toISOString();
  const logData = data
    ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}`
    : "";
  console.log(
    `[${LOG_TAG}] [${timestamp}] [${requestId}] DEBUG: ${message}${logData}`
  );
}

// Define the response interface for the Dify API
interface DifyResponse {
  id: string;
  answer: string;
  created_at: number;
  conversation_id?: string;
  task_id?: string;
  message_id?: string;
  event?: string;
  mode?: string;
  metadata?: {
    usage?: {
      completion_tokens: number;
      prompt_tokens: number;
      total_tokens: number;
      total_price?: string;
      currency?: string;
      latency?: number;
      prompt_unit_price?: string;
      prompt_price_unit?: string;
      prompt_price?: string;
      completion_unit_price?: string;
      completion_price_unit?: string;
      completion_price?: string;
    };
  };
}

// Define streaming event interfaces
interface DifyStreamEvent {
  event: string;
  task_id?: string;
  workflow_run_id?: string;
  message_id?: string;
  created_at?: number;
  data?: any;
  audio?: string;
}

// @ts-ignore: Deno global is available in Supabase Edge Functions
Deno.serve(async (req) => {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const requestId = generateRequestId();
  let userId: string | null = null;
  let inspectionId: string | null = null;
  let functionName: string | null = null;
  let requestData: any = null;
  let errorMessage: string | null = null;

  logInfo(requestId, "Function call started", {
    url: req.url,
    method: req.method,
  });

  try {
    const body = await req.json();
    const {
      function_name,
      user_id,
      inspection_id,
      response_mode = "blocking",
      files,
      ...rest
    } = body;

    logDebug(requestId, "Request body parsed", {
      function_name,
      user_id,
      inspection_id,
      response_mode,
      inputs_count: Object.keys(rest).length,
      files_count: files ? files.length : 0,
    });

    functionName = function_name;
    inspectionId = inspection_id || null;

    // Prepare inputs based on function type (will be determined later)
    const inputs = { ...rest };

    // Initialize requestData - will be updated with final request body later
    requestData = {
      inputs: inputs,
      user: userId || "abc-123",
      response_mode,
      ...(files && { files }),
    };

    // Get user_id from function params or JWT token
    userId = user_id || null;
    // if (!userId) {
    //   logDebug(requestId, "Attempting to extract user from JWT token");
    //   try {
    //     const authHeader = req.headers.get("Authorization");
    //     if (authHeader) {
    //       const token = authHeader.replace("Bearer ", "");
    //       // Create a temporary supabase client to get user from JWT
    //       const tempSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    //       const {
    //         data: { user },
    //       } = await tempSupabase.auth.getUser(token);
    //       userId = user?.id || null;
    //       logDebug(requestId, "User extracted from JWT", {
    //         userId: userId ? "[PRESENT]" : "[MISSING]",
    //       });
    //     } else {
    //       logWarning(requestId, "No Authorization header found");
    //     }
    //   } catch (authError) {
    //     logWarning(requestId, "Could not extract user from JWT", authError);
    //   }
    // } else {
    //   logDebug(requestId, "User ID provided in request", {
    //     userId: "[PRESENT]",
    //   });
    // }

    if (!function_name) {
      errorMessage = "function_name parameter is required";
      logError(requestId, "Missing required parameter: function_name");

      // Log error to database
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const endTime = Date.now();
      const endedAt = new Date().toISOString();
      const executionTime = (endTime - startTime) / 1000;

      await logActivity(supabase, {
        user_id: userId,
        inspection_id: inspectionId,
        function_name: functionName,
        request_data: requestData,
        error: errorMessage,
        started_at: startedAt,
        ended_at: endedAt,
        execution_time: executionTime,
      });

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    logInfo(requestId, "Processing function call", {
      function_name,
      userId: userId ? "[PRESENT]" : "[MISSING]",
      response_mode,
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Fetch the Dify API key from the database
    logDebug(requestId, "Fetching function mapping from database", {
      function_name,
    });
    const { data: mappingData, error: mappingError } = await supabase
      .from("dify_function_mapping")
      .select("*")
      .eq("function_name", function_name)
      .single();

    if (mappingError || !mappingData) {
      errorMessage = `Failed to retrieve function mapping: ${
        mappingError?.message || "No mapping found"
      }`;
      logError(requestId, "Function mapping retrieval failed", {
        function_name,
        error: mappingError,
      });

      // Log error to database
      const endTime = Date.now();
      const endedAt = new Date().toISOString();
      const executionTime = (endTime - startTime) / 1000;

      await logActivity(supabase, {
        user_id: userId,
        inspection_id: inspectionId,
        function_name: functionName,
        request_data: requestData,
        error: errorMessage,
        started_at: startedAt,
        ended_at: endedAt,
        execution_time: executionTime,
      });

      return new Response(
        JSON.stringify({
          error: "Failed to retrieve function mapping",
          details: mappingError,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    logInfo(requestId, "Function mapping retrieved successfully", {
      function_name,
      type: mappingData.type,
      has_api_key: !!mappingData.api_key,
    });

    // Determine API path based on type
    const path =
      mappingData.type === "completion"
        ? "completion-messages"
        : "workflows/run";
    const difyUrl = `${DIFY_API_ENDPOINT}/${path}`;

    logDebug(requestId, "Making request to Dify API", {
      url: difyUrl,
      type: mappingData.type,
      response_mode,
      inputs_count: Object.keys(rest).length,
      files_count: files ? files.length : 0,
    });

    // Prepare the request body according to Dify API documentation
    let finalRequestBody: any;

    if (mappingData.type === "completion") {
      // For completion API: follow the exact structure from Dify docs
      finalRequestBody = {
        inputs: {},
        response_mode: response_mode || "blocking",
        user: userId || "abc-123",
      };

      // Add all inputs to the inputs object
      // For completion, the main input should be in 'query' field if it's a text input
      finalRequestBody.inputs.input = String(rest.query);

      // Add files at root level if present (according to Dify docs)
      if (files && files.length > 0) {
        finalRequestBody.files = files.map((file: any) => {
          // Ensure proper file format according to Dify docs
          const fileObj: any = {
            type: file.type || "image",
          };

          if (file.transfer_method === "local_file" && file.upload_file_id) {
            fileObj.transfer_method = "local_file";
            fileObj.upload_file_id = file.upload_file_id;
          } else {
            fileObj.transfer_method = "remote_url";
            fileObj.url = file.url || file;
          }

          return fileObj;
        });
      }
    } else {
      // For workflow API: structure according to workflow requirements
      finalRequestBody = {
        inputs: {},
        response_mode: response_mode || "blocking",
        user: userId || "abc-123",
      };

      // Add all inputs to the inputs object
      Object.keys(rest).forEach((key) => {
        if (rest[key] !== undefined && rest[key] !== null) {
          finalRequestBody.inputs[key] = String(rest[key]);
        }
      });

      // Add inspection_id if provided
      if (inspection_id) {
        finalRequestBody.inputs.inspection_id = inspection_id;
      }

      // Add user_id to inputs for workflow context
      if (userId) {
        finalRequestBody.inputs.user_id = userId;
      }

      // For workflows, files might need to be in inputs or at root level
      // Check if files should be in inputs as images array
      if (files && files.length > 0) {
        finalRequestBody.inputs.images = files.map((file: any) => {
          const fileObj: any = {
            type: file.type || "image",
          };

          if (file.transfer_method === "local_file" && file.upload_file_id) {
            fileObj.transfer_method = "local_file";
            fileObj.upload_file_id = file.upload_file_id;
          } else {
            fileObj.transfer_method = "remote_url";
            fileObj.url = file.url || file;
          }

          return fileObj;
        });
      }
    }

    // Update requestData with the final request body for logging
    requestData = finalRequestBody;

    logDebug(requestId, "Final request body prepared", {
      type: mappingData.type,
      inputs_keys: Object.keys(finalRequestBody.inputs || {}),
      has_files: !!(finalRequestBody.files || finalRequestBody.inputs?.images),
      response_mode: finalRequestBody.response_mode,
      user: finalRequestBody.user,
    });

    // Make the request to Dify API with proper headers
    logDebug(requestId, "Making request to Dify API", {
      url: difyUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${
          mappingData.api_key ? "[PRESENT]" : "[MISSING]"
        }`,
      },
      body_preview: JSON.stringify(finalRequestBody).substring(0, 500),
    });
    let response: Response;
    if (mappingData.type === "completion") {
      response = await fetch(difyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mappingData.api_key}`,
        },
        body: JSON.stringify({
          inputs: {
            input: "Provide the results with the image url",
          },
          response_mode: "blocking",
          user: "abc-123",
          files: [
            {
              type: "image",
              transfer_method: "remote_url",
              url: files && files.length > 0 ? String(files[0].url) : "",
            },
          ],
        }),
      });
    } else {
      response = await fetch(difyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mappingData.api_key}`,
        },
        body: JSON.stringify(finalRequestBody),
      });
    }
    if (!response.ok) {
      const errorText = await response.text();
      errorMessage = `Dify API request failed: ${response.status} - ${errorText}`;

      // Try to parse error as JSON for better error details
      let parsedError: any = null;
      try {
        parsedError = JSON.parse(errorText);
      } catch (parseErr) {
        // Error text is not JSON, keep as is
      }

      logError(requestId, "Dify API request failed", {
        status: response.status,
        statusText: response.statusText,
        url: difyUrl,
        errorText: truncateIfNeeded(errorText),
        parsedError: parsedError,
        requestBody: truncateIfNeeded(JSON.stringify(finalRequestBody)),
        headers: Object.fromEntries(response.headers.entries()),
      });

      // Log error to database
      const endTime = Date.now();
      const endedAt = new Date().toISOString();
      const executionTime = (endTime - startTime) / 1000;

      await logActivity(supabase, {
        user_id: userId,
        inspection_id: inspectionId,
        function_name: functionName,
        request_data: finalRequestBody, // Use the actual request body sent
        error: errorMessage,
        started_at: startedAt,
        ended_at: endedAt,
        execution_time: executionTime,
      });

      return new Response(
        JSON.stringify({
          error: "Dify API request failed",
          status: response.status,
          statusText: response.statusText,
          details: parsedError || errorText,
          dify_error_code: parsedError?.code,
          dify_error_message: parsedError?.message,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Handle streaming vs blocking response
    if (response_mode === "streaming") {
      logInfo(requestId, "Handling streaming response");

      // For streaming, we need to process the SSE stream
      if (!response.body) {
        throw new Error("No response body received from Dify API");
      }

      // Set up streaming response headers
      const headers = new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });

      // Create a readable stream to handle the Dify streaming response
      const stream = new ReadableStream({
        async start(controller) {
          try {
            await handleDifyStreamingResponse(
              response,
              requestId,
              userId,
              inspectionId,
              functionName,
              requestData,
              startedAt,
              supabase,
              controller
            );
          } catch (error) {
            logError(requestId, "Error in streaming handler", error);
            controller.error(error);
          }
        },
      });

      return new Response(stream, { headers });
    } else {
      // Handle blocking response (existing logic)
      const difyResponse: DifyResponse = await response.json();

      logInfo(requestId, "Dify API response received successfully", {
        response_id: difyResponse.id,
        task_id: difyResponse.task_id,
        message_id: difyResponse.message_id,
        event: difyResponse.event,
        mode: difyResponse.mode,
        answer_length: difyResponse.answer?.length || 0,
        has_usage_data: !!difyResponse.metadata?.usage,
      });

      if (difyResponse.metadata?.usage) {
        logDebug(requestId, "Usage metrics", {
          prompt_tokens: difyResponse.metadata.usage.prompt_tokens,
          completion_tokens: difyResponse.metadata.usage.completion_tokens,
          total_tokens: difyResponse.metadata.usage.total_tokens,
          total_price: difyResponse.metadata.usage.total_price,
          currency: difyResponse.metadata.usage.currency,
          latency: difyResponse.metadata.usage.latency,
        });
      }

      // Log successful request and response to ai_activity_logs table
      const endTime = Date.now();
      const endedAt = new Date().toISOString();
      const executionTime = (endTime - startTime) / 1000;
      const calculatedLatency = executionTime;

      logDebug(requestId, "Logging activity to database", {
        execution_time: executionTime,
      });

      await logActivity(supabase, {
        user_id: userId,
        inspection_id: inspectionId,
        task_id: difyResponse.task_id || null,
        message_id: difyResponse.message_id || difyResponse.id || null,
        event: difyResponse.event || "message",
        mode: difyResponse.mode || mappingData.type || "completion",
        function_name: functionName,
        request_data: requestData,
        response_data: difyResponse,
        answer: difyResponse.answer || null,
        prompt_tokens: difyResponse.metadata?.usage?.prompt_tokens || null,
        prompt_unit_price:
          difyResponse.metadata?.usage?.prompt_unit_price || null,
        prompt_price_unit:
          difyResponse.metadata?.usage?.prompt_price_unit || null,
        prompt_price: difyResponse.metadata?.usage?.prompt_price || null,
        completion_tokens:
          difyResponse.metadata?.usage?.completion_tokens || null,
        completion_unit_price:
          difyResponse.metadata?.usage?.completion_unit_price || null,
        completion_price_unit:
          difyResponse.metadata?.usage?.completion_price_unit || null,
        completion_price:
          difyResponse.metadata?.usage?.completion_price || null,
        total_tokens: difyResponse.metadata?.usage?.total_tokens || null,
        total_price: difyResponse.metadata?.usage?.total_price || null,
        currency: difyResponse.metadata?.usage?.currency || "USD",
        latency: difyResponse.metadata?.usage?.latency || calculatedLatency,
        started_at: startedAt,
        ended_at: endedAt,
        execution_time: executionTime,
      });

      logInfo(requestId, "Function call completed successfully", {
        execution_time: executionTime,
        answer_length: difyResponse.answer?.length || 0,
      });

      // Return the Dify API response
      return new Response(
        JSON.stringify({
          success: true,
          payload: difyResponse.answer,
          metadata: difyResponse.metadata,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    errorMessage = `Internal server error: ${error.message}`;
    logError(requestId, "Unhandled error in function execution", {
      error: error.message,
      stack: error.stack,
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
      execution_time: executionTime,
    });

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * Handle Dify streaming response
 */
async function handleDifyStreamingResponse(
  response: Response,
  requestId: string,
  userId: string | null,
  inspectionId: string | null,
  functionName: string | null,
  requestData: any,
  startedAt: string,
  supabase: any,
  controller: ReadableStreamDefaultController
): Promise<void> {
  if (!response.body) {
    throw new Error("No response body received from Dify API");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let workflowRunId: string | null = null;
  let taskId: string | null = null;
  let finalOutputs: any = null;
  let totalTokens: number | null = null;
  let accumulatedPrice: number = 0; // Accumulate price from all nodes
  let totalPrice: string | null = null; // Final total from workflow_finished
  let currency: string | null = null;
  let workflowStatus: string | null = null;
  let nodeExecutionData: any[] = []; // Track all node executions

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Accumulate chunks in buffer to handle partial JSON
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const eventData = await processDifyStreamLine(
            line,
            requestId,
            userId,
            inspectionId,
            functionName,
            supabase
          );

          // Track important data for final logging
          if (eventData) {
            if (eventData.workflow_run_id)
              workflowRunId = eventData.workflow_run_id;
            if (eventData.task_id) taskId = eventData.task_id;

            // Accumulate pricing data from each node_finished event
            if (
              eventData.event === "node_finished" &&
              eventData.data?.execution_metadata
            ) {
              const nodePrice = parseFloat(
                eventData.data.execution_metadata.total_price || "0"
              );
              const nodeCurrency = eventData.data.execution_metadata.currency;

              if (nodePrice > 0) {
                accumulatedPrice += nodePrice;
                if (!currency && nodeCurrency) currency = nodeCurrency;

                // Store node execution data for detailed logging
                nodeExecutionData.push({
                  node_id: eventData.data.node_id,
                  node_type: eventData.data.node_type,
                  title: eventData.data.title,
                  index: eventData.data.index,
                  status: eventData.data.status,
                  elapsed_time: eventData.data.elapsed_time,
                  tokens: eventData.data.execution_metadata.total_tokens,
                  price: nodePrice,
                  currency: nodeCurrency,
                });

                logDebug(
                  requestId,
                  `💰 [PRICE_ACCUMULATION] Node ${eventData.data.title}:`,
                  {
                    node_price: nodePrice,
                    accumulated_total: accumulatedPrice,
                    currency: nodeCurrency,
                    node_tokens: eventData.data.execution_metadata.total_tokens,
                  }
                );
              }
            }

            if (eventData.event === "workflow_finished") {
              finalOutputs = eventData.data?.outputs;
              totalTokens = eventData.data?.total_tokens;
              workflowStatus = eventData.data?.status;

              // workflow_finished doesn't contain total_price, so we use our accumulated total
              totalPrice =
                accumulatedPrice > 0 ? accumulatedPrice.toString() : null;

              logInfo(
                requestId,
                `💰 [FINAL_PRICE_CALCULATION] Function ${functionName}:`,
                {
                  accumulated_price: accumulatedPrice,
                  final_total_price: totalPrice,
                  currency: currency,
                  nodes_processed: nodeExecutionData.length,
                  total_tokens: totalTokens,
                }
              );
            }
          }

          // Forward the event to the client
          controller.enqueue(new TextEncoder().encode(`${line}\n\n`));
        }
      }
    }

    // Log final workflow completion
    if (workflowRunId && taskId) {
      const endTime = Date.now();
      const endedAt = new Date().toISOString();
      const executionTime =
        (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;

      await logActivity(supabase, {
        user_id: userId,
        task_id: taskId,
        workflow_run_id: workflowRunId,
        event: "workflow_finished",
        mode: "workflow",
        function_name: functionName,
        request_data: requestData,
        response_data: {
          ...finalOutputs,
          node_execution_summary: nodeExecutionData,
          price_breakdown: {
            accumulated_from_nodes: accumulatedPrice,
            official_total: totalPrice,
            currency: currency,
          },
        },
        answer: finalOutputs ? JSON.stringify(finalOutputs) : null,
        total_tokens: totalTokens,
        total_price: totalPrice, // Use official total from Dify
        currency: currency || "USD",
        started_at: startedAt,
        ended_at: endedAt,
        execution_time: executionTime,
        status: workflowStatus,
      });

      logInfo(requestId, "Streaming workflow completed", {
        workflow_run_id: workflowRunId,
        task_id: taskId,
        status: workflowStatus,
        execution_time: executionTime,
        nodes_executed: nodeExecutionData.length,
        accumulated_price: accumulatedPrice,
        official_total_price: totalPrice,
        currency: currency,
      });
    }

    controller.close();
  } catch (error) {
    logError(requestId, "Error in streaming response handler", error);
    controller.error(error);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Process individual Dify stream line
 */
async function processDifyStreamLine(
  line: string,
  requestId: string,
  userId: string | null,
  inspectionId: string | null,
  functionName: string | null,
  supabase: any
): Promise<DifyStreamEvent | null> {
  try {
    const jsonStr = line.slice(6).trim();
    if (!jsonStr) return null;

    const data: DifyStreamEvent = JSON.parse(jsonStr);

    // Handle different event types with detailed logging
    switch (data.event) {
      case "workflow_started":
        logInfo(requestId, `🚀 [WORKFLOW_STARTED] Function ${functionName}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          workflow_id: data.data?.workflow_id,
          created_at: data.data?.created_at,
        });

        // Update inspections table with workflow IDs if inspection_id is available
        if (data.workflow_run_id && data.data?.workflow_id) {
          await updateInspectionWithWorkflowIds(
            supabase,
            requestId,
            userId,
            inspectionId, // Pass the inspection ID from the original request
            data.workflow_run_id,
            data.data.workflow_id,
            functionName
          );
        }
        break;

      case "node_started":
        logInfo(requestId, `🔄 [NODE_STARTED] Function ${functionName}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          node_id: data.data?.node_id,
          node_type: data.data?.node_type,
          title: data.data?.title,
          index: data.data?.index,
          predecessor_node_id: data.data?.predecessor_node_id,
          created_at: data.data?.created_at,
        });
        break;

      case "text_chunk":
        logDebug(requestId, `📝 [TEXT_CHUNK] Function ${functionName}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          text:
            data.data?.text?.substring(0, 100) +
            (data.data?.text?.length > 100 ? "..." : ""),
          from_variable_selector: data.data?.from_variable_selector,
        });
        break;

      case "node_finished":
        logInfo(requestId, `✅ [NODE_FINISHED] Function ${functionName}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          node_id: data.data?.node_id,
          node_type: data.data?.node_type,
          title: data.data?.title,
          index: data.data?.index,
          status: data.data?.status,
          elapsed_time: data.data?.elapsed_time,
          total_tokens: data.data?.execution_metadata?.total_tokens,
          total_price: data.data?.execution_metadata?.total_price,
          currency: data.data?.execution_metadata?.currency,
          error: data.data?.error,
        });
        break;

      case "workflow_finished":
        logInfo(requestId, `🏁 [WORKFLOW_FINISHED] Function ${functionName}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          workflow_id: data.data?.workflow_id,
          status: data.data?.status,
          elapsed_time: data.data?.elapsed_time,
          total_tokens: data.data?.total_tokens,
          total_steps: data.data?.total_steps,
          outputs: data.data?.outputs,
          error: data.data?.error,
          created_at: data.data?.created_at,
          finished_at: data.data?.finished_at,
        });
        break;

      case "tts_message":
        logDebug(requestId, `🔊 [TTS_MESSAGE] Function ${functionName}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          message_id: data.message_id,
          audio_length: data.audio?.length || 0,
          created_at: data.created_at,
        });
        break;

      case "tts_message_end":
        logDebug(requestId, `🔇 [TTS_MESSAGE_END] Function ${functionName}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          message_id: data.message_id,
          created_at: data.created_at,
        });
        break;

      case "ping":
        logDebug(
          requestId,
          `💓 [PING] Function ${functionName}: Connection keepalive`
        );
        break;

      default:
        logWarning(requestId, `❓ [UNKNOWN_EVENT] Function ${functionName}:`, {
          event: data.event,
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          data: data.data,
        });
        break;
    }

    return data;
  } catch (parseError) {
    logWarning(
      requestId,
      `⚠️ Failed to parse streaming data for function ${functionName}:`,
      {
        error: parseError.message,
        line: line.substring(0, 200) + (line.length > 200 ? "..." : ""),
      }
    );
    return null;
  }
}

// Helper function to update inspections table with workflow IDs
async function updateInspectionWithWorkflowIds(
  supabase: any,
  requestId: string,
  userId: string | null,
  inspectionId: string | null,
  workflowRunId: string,
  workflowId: string,
  functionName: string | null
): Promise<void> {
  try {
    logDebug(
      requestId,
      `🔄 [UPDATE_INSPECTION] Function ${functionName}: Updating inspection with workflow IDs`,
      {
        inspection_id: inspectionId || "[NOT_PROVIDED]",
        workflow_run_id: workflowRunId,
        workflow_id: workflowId,
        user_id: userId ? "[PRESENT]" : "[MISSING]",
      }
    );

    let targetInspectionId: string;
    let inspection: any = null;

    if (inspectionId) {
      // Use the provided inspection ID
      targetInspectionId = inspectionId;

      // Optionally fetch current inspection data for logging
      const { data: inspectionData, error: fetchError } = await supabase
        .from("inspections")
        .select("id, status, workflow_run_id, workflow_id")
        .eq("id", inspectionId)
        .single();

      if (fetchError) {
        logWarning(
          requestId,
          `⚠️ [UPDATE_INSPECTION_WARNING] Function ${functionName}: Could not fetch inspection data for logging`,
          {
            error: fetchError.message,
            inspection_id: inspectionId,
          }
        );
      } else {
        inspection = inspectionData;
      }
    } else {
      // Fall back to finding the most recent inspection for this user
      logDebug(
        requestId,
        `🔍 [UPDATE_INSPECTION] Function ${functionName}: No inspection ID provided, finding most recent for user`
      );

      const { data: inspectionData, error: fetchError } = await supabase
        .from("inspections")
        .select("id, status, workflow_run_id, workflow_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (fetchError) {
        logError(
          requestId,
          `❌ [UPDATE_INSPECTION_ERROR] Function ${functionName}: Failed to fetch inspection`,
          {
            error: fetchError.message,
            code: fetchError.code,
            user_id: userId ? "[PRESENT]" : "[MISSING]",
          }
        );
        return;
      }

      if (!inspectionData || inspectionData.length === 0) {
        logWarning(
          requestId,
          `⚠️ [UPDATE_INSPECTION_WARNING] Function ${functionName}: No inspection found for user`,
          {
            user_id: userId ? "[PRESENT]" : "[MISSING]",
          }
        );
        return;
      }

      inspection = inspectionData[0];
      targetInspectionId = inspection.id;
    }

    // Update the inspection with workflow IDs
    const { error: updateError } = await supabase
      .from("inspections")
      .update({
        workflow_run_id: workflowRunId,
        workflow_id: workflowId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetInspectionId);

    if (updateError) {
      logError(
        requestId,
        `❌ [UPDATE_INSPECTION_ERROR] Function ${functionName}: Failed to update inspection`,
        {
          error: updateError.message,
          code: updateError.code,
          inspection_id: targetInspectionId,
          workflow_run_id: workflowRunId,
          workflow_id: workflowId,
        }
      );
    } else {
      logInfo(
        requestId,
        `✅ [UPDATE_INSPECTION_SUCCESS] Function ${functionName}: Inspection updated successfully`,
        {
          inspection_id: targetInspectionId,
          workflow_run_id: workflowRunId,
          workflow_id: workflowId,
          previous_workflow_run_id: inspection?.workflow_run_id,
          previous_workflow_id: inspection?.workflow_id,
        }
      );
    }
  } catch (error) {
    logError(
      requestId,
      `❌ [UPDATE_INSPECTION_EXCEPTION] Function ${functionName}: Exception in updateInspectionWithWorkflowIds`,
      {
        error: error.message,
        stack: error.stack,
        workflow_run_id: workflowRunId,
        workflow_id: workflowId,
      }
    );
  }
}

// Helper function to log activity with error handling
async function logActivity(supabase: any, data: any) {
  const requestId = generateRequestId();

  try {
    logDebug(requestId, "Preparing activity log data", {
      has_user_id: !!data.user_id,
      has_function_name: !!data.function_name,
      has_error: !!data.error,
      execution_time: data.execution_time,
    });

    const logData = {
      user_id: data.user_id || null,
      inspection_id: data.inspection_id || null,
      task_id: data.task_id || null,
      message_id: data.message_id || null,
      workflow_run_id: data.workflow_run_id || null,
      event: data.event || "message",
      mode: data.mode || "completion",
      function_name: data.function_name || "unknown",
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
      currency: data.currency || "USD",
      latency: data.latency || null,
      error: data.error || null,
      started_at: data.started_at || null,
      ended_at: data.ended_at || null,
      execution_time: data.execution_time || null,
      status: data.status || null,
    };

    logDebug(requestId, "Inserting activity log into database", {
      table: "ai_activity_logs",
      function_name: logData.function_name,
      has_error: !!logData.error,
    });

    const { error: logError } = await supabase
      .from("ai_activity_logs")
      .insert(logData);

    if (logError) {
      logError(requestId, "Failed to insert activity log", {
        error: logError.message,
        code: logError.code,
        details: logError.details,
      });
    } else {
      logDebug(requestId, "Activity log inserted successfully", {
        function_name: logData.function_name,
        execution_time: logData.execution_time,
      });
    }
  } catch (logError) {
    logError(requestId, "Exception in logging process", {
      error: logError.message,
      stack: logError.stack,
    });
  }
}
