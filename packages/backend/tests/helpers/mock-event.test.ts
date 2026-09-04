/**
 * Unit tests for the mock event factory.
 * Validates: Requirements 20.1
 */

import { describe, it, expect } from 'vitest';
import { createMockEvent } from './mock-event.js';

describe('createMockEvent', () => {
  it('creates an event with required fields', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
    });

    expect(event.httpMethod).toBe('GET');
    expect(event.resource).toBe('/workers');
    expect(event.path).toBe('/workers');
    expect(event.pathParameters).toBeNull();
    expect(event.queryStringParameters).toBeNull();
    expect(event.body).toBeNull();
    expect(event.isBase64Encoded).toBe(false);
    expect(event.requestContext.requestId).toBeDefined();
  });

  it('uses resource as path when path is not provided', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}',
    });

    expect(event.path).toBe('/workers/{id}');
  });

  it('uses custom path when provided', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}',
      path: '/workers/abc-123',
    });

    expect(event.resource).toBe('/workers/{id}');
    expect(event.path).toBe('/workers/abc-123');
  });

  it('sets pathParameters when provided', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}',
      path: '/workers/abc-123',
      pathParameters: { id: 'abc-123' },
    });

    expect(event.pathParameters).toEqual({ id: 'abc-123' });
  });

  it('sets queryStringParameters when provided', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
      queryStringParameters: { limit: '10', offset: '0' },
    });

    expect(event.queryStringParameters).toEqual({ limit: '10', offset: '0' });
  });

  it('serializes body to JSON string', () => {
    const body = { legal_name: 'Jane Doe', phone: '+14155551234' };
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers',
      body,
    });

    expect(event.body).toBe(JSON.stringify(body));
  });

  it('sets body to null when body is not provided', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
    });

    expect(event.body).toBeNull();
  });

  it('includes default Content-Type header', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
    });

    expect(event.headers['Content-Type']).toBe('application/json');
  });

  it('merges custom headers with defaults', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
      headers: { 'X-Custom-Header': 'test-value' },
    });

    expect(event.headers['Content-Type']).toBe('application/json');
    expect(event.headers['X-Custom-Header']).toBe('test-value');
  });

  it('includes default Authorization header when not noAuth', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
    });

    expect(event.headers['Authorization']).toBe('Bearer mock-token');
  });

  it('populates requestContext.authorizer.claims when claims are provided', () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers',
      claims: {
        sub: 'user-1',
        'custom:role': 'tenant_admin',
        'custom:tenant_id': 'tenant-1',
      },
    });

    expect(event.requestContext.authorizer).toBeDefined();
    expect(event.requestContext.authorizer!.claims).toEqual({
      sub: 'user-1',
      'custom:role': 'tenant_admin',
      'custom:tenant_id': 'tenant-1',
    });
  });

  it('flattens array claims to comma-separated strings', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
      claims: {
        sub: 'user-1',
        'custom:role': 'site_admin',
        'custom:assigned_sites': ['site-1', 'site-2', 'site-3'],
      },
    });

    expect(event.requestContext.authorizer!.claims!['custom:assigned_sites']).toBe(
      'site-1,site-2,site-3',
    );
  });

  it('omits Authorization header when noAuth is true', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
      noAuth: true,
    });

    expect(event.headers['Authorization']).toBeUndefined();
    expect(event.headers['authorization']).toBeUndefined();
  });

  it('omits authorizer claims when noAuth is true even if claims are provided', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
      claims: { sub: 'user-1', 'custom:role': 'tenant_admin' },
      noAuth: true,
    });

    expect(event.requestContext.authorizer).toBeUndefined();
    expect(event.headers['Authorization']).toBeUndefined();
  });

  it('removes existing Authorization header from custom headers when noAuth is true', () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
      headers: { Authorization: 'Bearer some-token' },
      noAuth: true,
    });

    expect(event.headers['Authorization']).toBeUndefined();
  });

  it('generates unique requestContext.requestId for each event', () => {
    const event1 = createMockEvent({ httpMethod: 'GET', resource: '/workers' });
    const event2 = createMockEvent({ httpMethod: 'GET', resource: '/workers' });

    expect(event1.requestContext.requestId).not.toBe(event2.requestContext.requestId);
  });
});
