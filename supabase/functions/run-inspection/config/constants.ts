/**
 * Application constants
 */

export const TIMEOUTS = {
  N8N_WEBHOOK: 300000, // 5 minutes in milliseconds
  IMAGE_DOWNLOAD: 30000, // 30 seconds in milliseconds
} as const;

export const LIMITS = {
  MIN_IMAGES_REQUIRED: 3,
  MAX_IMAGE_RETRIES: 3,
  MAX_PAYLOAD_SIZE: "10mb",
} as const;

export const STORAGE = {
  DEFAULT_BUCKET: "inspection-images",
  IMAGE_CACHE_CONTROL: "3600",
  IMAGE_CONTENT_TYPE: "image/jpeg",
} as const;

export const LOG_CONFIG = {
  TAG: "RUN_INSPECTION",
  MAX_LOG_SIZE: 10000, // Maximum characters for request/response bodies in logs
  ENABLE_DETAILED_LOGGING: Deno.env.get("LOG_LEVEL") === "debug",
} as const;

