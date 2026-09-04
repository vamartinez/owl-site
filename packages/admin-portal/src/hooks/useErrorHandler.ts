import { useState, useCallback } from 'react';
import { ApiClientError } from '@/services/api-client';

const IS_DEBUG = import.meta.env.DEV;

export interface AppError {
  message: string;
  title?: string;
  debugInfo?: Record<string, unknown>;
}

/**
 * Maps API errors to user-friendly messages.
 * In debug mode, includes technical details.
 */
export function mapApiError(error: unknown): AppError {
  if (error instanceof ApiClientError) {
    const debugInfo: Record<string, unknown> = IS_DEBUG
      ? { status: error.status, code: error.code, details: error.details }
      : {};

    switch (error.status) {
      case 400:
        return {
          message: error.details?.errors
            ? 'There are errors in the form. Please check the highlighted fields.'
            : error.message || 'Invalid data. Please verify the information entered.',
          title: 'Validation Error',
          debugInfo,
        };
      case 401:
        return {
          message: 'Your session has expired. Please sign in again.',
          title: 'Session Expired',
          debugInfo,
        };
      case 403:
        return {
          message: 'You do not have permission to perform this action.',
          title: 'Access Denied',
          debugInfo,
        };
      case 404:
        return {
          message: 'The requested resource does not exist or the API endpoint is not available. Check your VITE_API_URL configuration.',
          title: 'Not Found',
          debugInfo,
        };
      case 409:
        return {
          message: error.message || 'Conflict: the resource already exists or was modified.',
          title: 'Conflict',
          debugInfo,
        };
      case 422:
        return {
          message: error.message || 'The request could not be processed.',
          title: 'Processing Error',
          debugInfo,
        };
      case 429:
        return {
          message: 'Too many requests. Please wait a moment before trying again.',
          title: 'Rate Limit Exceeded',
          debugInfo,
        };
      default:
        if (error.status >= 500) {
          return {
            message: 'Server error. Please try again later.',
            title: 'Internal Error',
            debugInfo,
          };
        }
        return {
          message: error.message || 'An unexpected error occurred.',
          title: 'Error',
          debugInfo,
        };
    }
  }

  if (error instanceof TypeError && error.message.includes('fetch')) {
    return {
      message: 'Could not connect to the server. Check your internet connection or API configuration.',
      title: 'Connection Error',
      debugInfo: IS_DEBUG ? { type: 'NetworkError', message: error.message } : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      title: 'Error',
      debugInfo: IS_DEBUG ? { name: error.name, stack: error.stack } : undefined,
    };
  }

  return {
    message: 'An unexpected error occurred.',
    title: 'Error',
    debugInfo: IS_DEBUG ? { raw: String(error) } : undefined,
  };
}

/**
 * Hook for managing error state in components.
 * Provides setError, clearError, and the mapped error object.
 */
export function useErrorHandler() {
  const [error, setErrorState] = useState<AppError | null>(null);

  const setError = useCallback((err: unknown) => {
    setErrorState(mapApiError(err));
  }, []);

  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  return { error, setError, clearError };
}
