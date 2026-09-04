import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateScheduleCommand, DeleteScheduleCommand, ResourceNotFoundException } from '@aws-sdk/client-scheduler';
import type { RegulatoryDeadline } from '../types';

// Use vi.hoisted to ensure mockSend is available when vi.mock factory runs
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-scheduler', async () => {
  const actual = await vi.importActual('@aws-sdk/client-scheduler');
  return {
    ...actual,
    SchedulerClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

// Mock the logger
vi.mock('../../../shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createDeadlineSchedule, cancelSchedule } from '../deadline-scheduler';

describe('deadline-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/scheduler-role';
    process.env.NOTIFICATION_FUNCTION_ARN = 'arn:aws:lambda:us-west-2:123456789012:function:notification-service';
    process.env.SCHEDULER_GROUP_NAME = 'incident-deadlines';
  });

  describe('createDeadlineSchedule', () => {
    const deadline: RegulatoryDeadline = {
      authority: 'OSHA',
      deadline_hours: 8,
      deadline_from: 'incident_time',
      absolute_deadline: '2024-01-15T18:00:00Z',
      description: 'OSHA fatality report deadline (8 hours)',
    };

    it('creates a one-time schedule with correct parameters', async () => {
      mockSend.mockResolvedValueOnce({
        ScheduleArn: 'arn:aws:scheduler:us-west-2:123456789012:schedule/incident-deadlines/incident-inc-001-osha-8h',
      });

      const result = await createDeadlineSchedule('inc-001', deadline);

      expect(result.scheduleName).toBe('incident-inc-001-osha-8h');
      expect(result.scheduleArn).toBe(
        'arn:aws:scheduler:us-west-2:123456789012:schedule/incident-deadlines/incident-inc-001-osha-8h'
      );

      // Verify the CreateScheduleCommand was called with correct params
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(CreateScheduleCommand);
      expect(command.input.Name).toBe('incident-inc-001-osha-8h');
      expect(command.input.GroupName).toBe('incident-deadlines');
      expect(command.input.ScheduleExpression).toBe('at(2024-01-15T18:00:00Z)');
      expect(command.input.ScheduleExpressionTimezone).toBe('UTC');
      expect(command.input.FlexibleTimeWindow.Mode).toBe('OFF');
      expect(command.input.Target.Arn).toBe(process.env.NOTIFICATION_FUNCTION_ARN);
      expect(command.input.Target.RoleArn).toBe(process.env.SCHEDULER_ROLE_ARN);
      expect(command.input.ActionAfterCompletion).toBe('DELETE');

      // Verify the payload contains incident and deadline info
      const payload = JSON.parse(command.input.Target.Input);
      expect(payload.event_type).toBe('regulatory.deadline_reached');
      expect(payload.incident_id).toBe('inc-001');
      expect(payload.authority).toBe('OSHA');
      expect(payload.deadline_hours).toBe(8);
      expect(payload.deadline_from).toBe('incident_time');
      expect(payload.absolute_deadline).toBe('2024-01-15T18:00:00Z');
      expect(payload.description).toBe('OSHA fatality report deadline (8 hours)');
    });

    it('creates a WorkSafeBC schedule with correct naming', async () => {
      const worksafebcDeadline: RegulatoryDeadline = {
        authority: 'WorkSafeBC',
        deadline_hours: 72,
        deadline_from: 'employer_knowledge',
        absolute_deadline: '2024-01-18T10:00:00Z',
        description: 'WorkSafeBC employer report deadline (72 hours)',
      };

      mockSend.mockResolvedValueOnce({
        ScheduleArn: 'arn:aws:scheduler:us-west-2:123456789012:schedule/incident-deadlines/incident-inc-002-worksafebc-72h',
      });

      const result = await createDeadlineSchedule('inc-002', worksafebcDeadline);

      expect(result.scheduleName).toBe('incident-inc-002-worksafebc-72h');
    });

    it('throws when SCHEDULER_ROLE_ARN is not configured', async () => {
      delete process.env.SCHEDULER_ROLE_ARN;

      await expect(createDeadlineSchedule('inc-001', deadline)).rejects.toThrow(
        'SCHEDULER_ROLE_ARN environment variable is not configured'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('throws when NOTIFICATION_FUNCTION_ARN is not configured', async () => {
      delete process.env.NOTIFICATION_FUNCTION_ARN;

      await expect(createDeadlineSchedule('inc-001', deadline)).rejects.toThrow(
        'NOTIFICATION_FUNCTION_ARN environment variable is not configured'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('uses default group name when SCHEDULER_GROUP_NAME is not set', async () => {
      delete process.env.SCHEDULER_GROUP_NAME;

      mockSend.mockResolvedValueOnce({
        ScheduleArn: 'arn:aws:scheduler:us-west-2:123456789012:schedule/incident-deadlines/test',
      });

      await createDeadlineSchedule('inc-001', deadline);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.GroupName).toBe('incident-deadlines');
    });

    it('returns empty string for scheduleArn when response has no ARN', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createDeadlineSchedule('inc-001', deadline);

      expect(result.scheduleArn).toBe('');
    });
  });

  describe('cancelSchedule', () => {
    it('deletes the schedule by name', async () => {
      mockSend.mockResolvedValueOnce({});

      await cancelSchedule('incident-inc-001-osha-8h');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(DeleteScheduleCommand);
      expect(command.input.Name).toBe('incident-inc-001-osha-8h');
      expect(command.input.GroupName).toBe('incident-deadlines');
    });

    it('handles ResourceNotFoundException gracefully (schedule already fired)', async () => {
      const notFoundError = new ResourceNotFoundException({
        message: 'Schedule not found',
        $metadata: {},
      });
      mockSend.mockRejectedValueOnce(notFoundError);

      // Should not throw
      await expect(cancelSchedule('incident-inc-001-osha-8h')).resolves.toBeUndefined();
    });

    it('rethrows non-ResourceNotFoundException errors', async () => {
      const genericError = new Error('Service unavailable');
      mockSend.mockRejectedValueOnce(genericError);

      await expect(cancelSchedule('incident-inc-001-osha-8h')).rejects.toThrow(
        'Service unavailable'
      );
    });

    it('uses default group name when SCHEDULER_GROUP_NAME is not set', async () => {
      delete process.env.SCHEDULER_GROUP_NAME;
      mockSend.mockResolvedValueOnce({});

      await cancelSchedule('incident-inc-001-osha-8h');

      const command = mockSend.mock.calls[0][0];
      expect(command.input.GroupName).toBe('incident-deadlines');
    });
  });
});
