/**
 * SNS Mobile Push notification channel — placeholder for future mobile app.
 *
 * This module will integrate with SNS Mobile Push (APNS/FCM) when the
 * mobile application development resumes. Currently returns a no-op result.
 *
 * Requirements: 10.3 (future)
 */

import { createLogger } from '../../../shared/logger.js';
import type { ChannelDeliveryResult } from '../types.js';

const logger = createLogger('notification-service:push');

export interface PushParams {
  device_token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  correlation_id?: string;
}

/**
 * Sends a push notification via SNS Mobile Push.
 * Currently a placeholder — returns a not-implemented result.
 * Will be implemented when mobile app development resumes.
 */
export async function sendPush(params: PushParams): Promise<ChannelDeliveryResult> {
  const { device_token, title, correlation_id } = params;

  logger.warn('Push notification channel not yet implemented', {
    device_token,
    title,
    correlation_id,
  });

  return {
    success: false,
    error: 'Push notification channel not yet implemented. Mobile app is paused.',
  };
}
