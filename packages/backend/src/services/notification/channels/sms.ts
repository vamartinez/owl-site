/**
 * Amazon SNS direct SMS publishing channel.
 *
 * Sends SMS notifications via Amazon SNS direct publish to phone numbers.
 *
 * Requirements: 10.3, 11.1
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { createLogger } from '../../../shared/logger.js';
import type { ChannelDeliveryResult } from '../types.js';

const snsClient = new SNSClient({});
const logger = createLogger('notification-service:sms');

export interface SmsParams {
  phoneNumber: string;
  message: string;
  correlation_id?: string;
}

/**
 * Sends an SMS notification via Amazon SNS direct publish.
 * Phone number must be in E.164 format (e.g., +16045551234).
 */
export async function sendSms(params: SmsParams): Promise<ChannelDeliveryResult> {
  const { phoneNumber, message, correlation_id } = params;

  logger.info('Sending SMS notification', {
    phoneNumber,
    message_length: message.length,
    correlation_id,
  });

  try {
    const result = await snsClient.send(
      new PublishCommand({
        PhoneNumber: phoneNumber,
        Message: message,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: 'Transactional',
          },
          'AWS.SNS.SMS.SenderID': {
            DataType: 'String',
            StringValue: 'Compliance',
          },
        },
      })
    );

    logger.info('SMS sent successfully', {
      message_id: result.MessageId,
      phoneNumber,
      correlation_id,
    });

    return {
      success: true,
      message_id: result.MessageId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown SNS error';

    logger.error('Failed to send SMS', {
      phoneNumber,
      error: errorMessage,
      correlation_id,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}
