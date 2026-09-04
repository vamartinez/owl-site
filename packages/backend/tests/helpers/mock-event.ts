/**
 * Mock API Gateway event factory for handler tests.
 * Generates valid APIGatewayProxyEvent-shaped objects compatible with
 * the platform's ApiGatewayEvent interface.
 *
 * Validates: Requirements 20.1
 */

import { randomUUID } from 'crypto';

export interface MockEventOptions {
  httpMethod: string;
  resource: string;
  path?: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  claims?: Record<string, string | string[]>;
  noAuth?: boolean;
}

export interface APIGatewayProxyEvent {
  httpMethod: string;
  resource: string;
  path: string;
  pathParameters: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  headers: Record<string, string>;
  body: string | null;
  requestContext: {
    requestId: string;
    authorizer?: {
      claims?: Record<string, string>;
    };
  };
  isBase64Encoded: boolean;
  multiValueHeaders: Record<string, string[]>;
  multiValueQueryStringParameters: Record<string, string[]> | null;
  stageVariables: Record<string, string> | null;
}

/**
 * Creates a mock API Gateway proxy event for use in handler tests.
 *
 * When `claims` is provided, populates `requestContext.authorizer.claims`
 * simulating a Cognito authorizer. When `noAuth` is true, no Authorization
 * header or claims are included (triggers 401 from auth middleware).
 */
export function createMockEvent(options: MockEventOptions): APIGatewayProxyEvent {
  const {
    httpMethod,
    resource,
    path,
    pathParameters,
    queryStringParameters,
    body,
    headers = {},
    claims,
    noAuth = false,
  } = options;

  // Build headers
  const eventHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  // Add default Authorization header unless noAuth is true
  if (!noAuth && !eventHeaders['Authorization'] && !eventHeaders['authorization']) {
    eventHeaders['Authorization'] = 'Bearer mock-token';
  }

  // Remove Authorization header if noAuth is explicitly set
  if (noAuth) {
    delete eventHeaders['Authorization'];
    delete eventHeaders['authorization'];
  }

  // Build requestContext
  const requestContext: APIGatewayProxyEvent['requestContext'] = {
    requestId: randomUUID(),
  };

  // Populate authorizer claims if provided and noAuth is not set
  if (claims && !noAuth) {
    // Flatten array values to comma-separated strings (API Gateway behavior)
    const flatClaims: Record<string, string> = {};
    for (const [key, value] of Object.entries(claims)) {
      flatClaims[key] = Array.isArray(value) ? value.join(',') : value;
    }
    requestContext.authorizer = { claims: flatClaims };
  }

  // Serialize body
  const serializedBody = body !== undefined && body !== null
    ? JSON.stringify(body)
    : null;

  return {
    httpMethod,
    resource,
    path: path ?? resource,
    pathParameters: pathParameters ?? null,
    queryStringParameters: queryStringParameters ?? null,
    headers: eventHeaders,
    body: serializedBody,
    requestContext,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
  };
}
