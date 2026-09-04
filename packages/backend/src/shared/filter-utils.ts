/**
 * Shared filter utility for building DynamoDB FilterExpressions.
 * Used by rejections, visits, and site-access-logs endpoints that support
 * search, decision/reason, and period query parameters.
 */

export interface FilterParams {
  search?: string;
  decision?: string;
  reason?: string;
  period?: string; // 'today' | '7d' | '30d' | '90d'
}

export interface FilterExpressionResult {
  filterExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
}

/**
 * Converts a period string to an ISO date representing the start of that period.
 * Supported values: 'today', '7d', '30d', '90d'.
 * Returns undefined for unrecognized period values.
 */
export function getPeriodStartDate(period: string): string | undefined {
  const now = new Date();

  switch (period) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return start.toISOString();
    }
    case '7d': {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return start.toISOString();
    }
    case '30d': {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return start.toISOString();
    }
    case '90d': {
      const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      return start.toISOString();
    }
    default:
      return undefined;
  }
}

/**
 * Builds a DynamoDB FilterExpression from optional query parameters.
 * Supports:
 * - `search`: case-insensitive substring match on worker_name
 * - `decision`: exact match on result field
 * - `reason`: exact match on reason field
 * - `period`: timestamp >= period start date
 *
 * Returns an object with filterExpression, expressionAttributeNames, and
 * expressionAttributeValues ready to spread into a DynamoDB query command.
 */
export function buildFilterExpression(params: FilterParams): FilterExpressionResult {
  const conditions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  if (params.search) {
    conditions.push('contains(#workerName, :search)');
    expressionAttributeNames['#workerName'] = 'worker_name';
    expressionAttributeValues[':search'] = params.search.toLowerCase();
  }

  if (params.decision) {
    conditions.push('#result = :decision');
    expressionAttributeNames['#result'] = 'result';
    expressionAttributeValues[':decision'] = params.decision;
  }

  if (params.reason) {
    conditions.push('#reason = :reason');
    expressionAttributeNames['#reason'] = 'reason';
    expressionAttributeValues[':reason'] = params.reason;
  }

  if (params.period) {
    const periodStart = getPeriodStartDate(params.period);
    if (periodStart) {
      conditions.push('#timestamp >= :periodStart');
      expressionAttributeNames['#timestamp'] = 'timestamp';
      expressionAttributeValues[':periodStart'] = periodStart;
    }
  }

  if (conditions.length === 0) {
    return {};
  }

  return {
    filterExpression: conditions.join(' AND '),
    expressionAttributeNames,
    expressionAttributeValues,
  };
}
