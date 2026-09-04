/**
 * Amazon SES transactional email delivery channel.
 *
 * Sends notification emails via Amazon SES using the configured sender address.
 *
 * Requirements: 10.3, 11.1
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { createLogger } from '../../../shared/logger.js';
import type { ChannelDeliveryResult } from '../types.js';

const sesClient = new SESClient({});
const logger = createLogger('notification-service:email');

const DEFAULT_SENDER = process.env['SES_SENDER_EMAIL'] ?? 'noreply@compliance.sitemacaron.com';

export interface EmailParams {
  to: string;
  subject: string;
  body: string;
  correlation_id?: string;
}

/**
 * Sends a transactional email via Amazon SES.
 */
export async function sendEmail(params: EmailParams): Promise<ChannelDeliveryResult> {
  const { to, subject, body, correlation_id } = params;

  logger.info('Sending email notification', {
    to,
    subject,
    correlation_id,
  });

  try {
    const result = await sesClient.send(
      new SendEmailCommand({
        Source: DEFAULT_SENDER,
        Destination: {
          ToAddresses: [to],
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: body,
              Charset: 'UTF-8',
            },
          },
        },
      })
    );

    logger.info('Email sent successfully', {
      message_id: result.MessageId,
      to,
      correlation_id,
    });

    return {
      success: true,
      message_id: result.MessageId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown SES error';

    logger.error('Failed to send email', {
      to,
      subject,
      error: errorMessage,
      correlation_id,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}
