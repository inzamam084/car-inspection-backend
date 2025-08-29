import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Logging configuration
const LOG_TAG = 'RUN_INSPECTION';
const MAX_LOG_SIZE = 10000; // Maximum characters for request/response bodies in logs
const ENABLE_DETAILED_LOGGING = true; // Set to false in production if needed

// Logging utility functions
export function generateRequestId(): string {
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
  const sensitiveFields = ['api_key', 'password', 'token', 'authorization', 'email', 'phone'];
  
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

export function logInfo(requestId: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}` : '';
  console.log(`[${LOG_TAG}] [${timestamp}] [${requestId}] INFO: ${message}${logData}`);
}

export function logError(requestId: string, message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  const errorData = error ? ` | Error: ${truncateIfNeeded(JSON.stringify(error))}` : '';
  console.error(`[${LOG_TAG}] [${timestamp}] [${requestId}] ERROR: ${message}${errorData}`);
}

export function logWarning(requestId: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}` : '';
  console.warn(`[${LOG_TAG}] [${timestamp}] [${requestId}] WARN: ${message}${logData}`);
}

export function logDebug(requestId: string, message: string, data?: any): void {
  if (!ENABLE_DETAILED_LOGGING) return;
  const timestamp = new Date().toISOString();
  const logData = data ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}` : '';
  console.log(`[${LOG_TAG}] [${timestamp}] [${requestId}] DEBUG: ${message}${logData}`);
}

// Context class to maintain request context throughout the pipeline
export class RequestContext {
  public readonly requestId: string;
  public readonly startTime: number;
  public readonly startedAt: string;
  public userId: string | null = null;
  public inspectionId: string | null = null;
  public operation: string = 'unknown';
  public requestData: any = null;

  constructor() {
    this.requestId = generateRequestId();
    this.startTime = Date.now();
    this.startedAt = new Date().toISOString();
  }

  setUser(userId: string | null): void {
    this.userId = userId;
  }

  setInspection(inspectionId: string | null): void {
    this.inspectionId = inspectionId;
  }

  setOperation(operation: string): void {
    this.operation = operation;
  }

  setRequestData(data: any): void {
    this.requestData = data;
  }

  getExecutionTime(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  getEndedAt(): string {
    return new Date().toISOString();
  }

  logSuccess(responseData?: any, additionalData?: any): void {
    this.info('Operation completed successfully', {
      operation: this.operation,
      execution_time: this.getExecutionTime(),
      inspection_id: this.inspectionId,
      user_id: this.userId ? '[PRESENT]' : '[MISSING]',
      response_data: responseData,
      additional_data: additionalData
    });
  }

  logError(error: string, responseData?: any): void {
    this.error('Operation failed', {
      operation: this.operation,
      execution_time: this.getExecutionTime(),
      inspection_id: this.inspectionId,
      user_id: this.userId ? '[PRESENT]' : '[MISSING]',
      error: error,
      response_data: responseData
    });
  }

  info(message: string, data?: any): void {
    logInfo(this.requestId, message, data);
  }

  error(message: string, error?: any): void {
    logError(this.requestId, message, error);
  }

  warn(message: string, data?: any): void {
    logWarning(this.requestId, message, data);
  }

  debug(message: string, data?: any): void {
    logDebug(this.requestId, message, data);
  }
}
