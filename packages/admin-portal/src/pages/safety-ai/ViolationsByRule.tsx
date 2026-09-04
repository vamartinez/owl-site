import { useApiQuery } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BarChart } from '@/components/charts/BarChart';
import { Scale } from 'lucide-react';

interface RuleViolation {
  ruleId: string;
  ruleName: string;
  category: string;
  totalViolations: number;
  openCount: number;
  resolvedCount: number;
}

interface ViolationsByRuleResponse {
  rules: RuleViolation[];
  chartData: { rule: string; count: number }[];
}

export default function ViolationsByRule() {
  const { data, isLoading } = useApiQuery<ViolationsByRuleResponse>(
    ['safety-ai', 'violations-by-rule'],
    '/safety-ai/violations-by-rule'
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Violations by Rule</h1>
          <p className="mt-1 text-sm text-gray-500">
            Safety rule violation breakdown
          </p>
        </div>
        <Scale size={24} className="text-gray-400" />
      </div>

      {data?.chartData && data.chartData.length > 0 && (
        <Card>
          <CardContent>
            <BarChart
              data={data.chartData}
              dataKey="count"
              xAxisKey="rule"
              color="#ef4444"
              height={280}
              label="Violations per Rule"
            />
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
          ))
        ) : (
          data?.rules.map((rule) => (
            <Card key={rule.ruleId}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium text-gray-900">{rule.ruleName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="info">{rule.category}</Badge>
                    <span className="text-xs text-gray-500">
                      {rule.totalViolations} total violations
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-center">
                    <p className="font-bold text-red-600">{rule.openCount}</p>
                    <p className="text-xs text-gray-500">Open</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-green-600">{rule.resolvedCount}</p>
                    <p className="text-xs text-gray-500">Resolved</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
        {!isLoading && (!data?.rules || data.rules.length === 0) && (
          <p className="text-sm text-gray-500 text-center py-8">No violations recorded</p>
        )}
      </div>
    </div>
  );
}
