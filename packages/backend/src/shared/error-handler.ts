/**
 * Consistent error response formatting for all API responses.
 * Provides structured error objects with code, message, request_id, timestamp, and details.
 */

import { v4 as uuidv4 } from 'uuid';

export interface ErrorResponse {
  code: string;
  message: string;
  request_id: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface ApiGatewayResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Correlation-Id,X-Tenant-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

/**
 * Creates a structured error response.
 */
export function createErrorResponse(
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string
): ApiGatewayResponse {
  const errorBody: ErrorResponse = {
    code,
    message,
    request_id: requestId ?? uuidv4(),
    timestamp: new Date().toISOString(),
    ...(details && { details }),
  };

  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(errorBody),
  };
}

/**
 * Creates a successful JSON response.
 */
export function createSuccessResponse(
  statusCode: number,
  body: unknown
): ApiGatewayResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

// --- Common Error Factories ---

export function badRequest(message: string, details?: Record<string, unknown>): ApiGatewayResponse {
  return createErrorResponse(400, 'BAD_REQUEST', message, details);
}

export function unauthorized(message = 'Authentication required'): ApiGatewayResponse {
  return createErrorResponse(401, 'UNAUTHORIZED', message);
}

export function forbidden(message = 'Access denied'): ApiGatewayResponse {
  return createErrorResponse(403, 'FORBIDDEN', message);
}

export function notFound(message = 'Resource not found'): ApiGatewayResponse {
  return createErrorResponse(404, 'NOT_FOUND', message);
}

export function conflict(message: string, details?: Record<string, unknown>): ApiGatewayResponse {
  return createErrorResponse(409, 'CONFLICT', message, details);
}

export function unprocessableEntity(
  message: string,
  details?: Record<string, unknown>
): ApiGatewayResponse {
  return createErrorResponse(422, 'UNPROCESSABLE_ENTITY', message, details);
}

export function internalError(message = 'Internal server error'): ApiGatewayResponse {
  return createErrorResponse(500, 'INTERNAL_ERROR', message);
}

export function serviceUnavailable(message = 'Service temporarily unavailable'): ApiGatewayResponse {
  return createErrorResponse(503, 'SERVICE_UNAVAILABLE', message);
}
