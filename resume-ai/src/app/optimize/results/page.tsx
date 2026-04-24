import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ProgressBar } from '@/components/ProgressBar';
import { mockOptimizationResult } from '@/lib/mock-data';

export default function OptimizeResultsPage() {
  const { keywordGaps, requirementCoverage, suggestions } = mockOptimizationResult;

  const foundCount = keywordGaps.filter((k) => k.found).length;
  const coveredCount = requirementCoverage.filter((r) => r.covered).length;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Optimization Results</h1>
          <p className="text-slate-500 text-sm">Keyword gaps, requirement coverage, and suggested improvements</p>
        </div>

        {/* Summary cards */}
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <Card>
            <p className="text-xs font-medium text-slate-500 mb-1">Keyword Coverage</p>
            <p className="text-2xl font-bold text-slate-900 mb-2">{foundCount}/{keywordGaps.length}</p>
            <ProgressBar value={foundCount} max={keywordGaps.length} size="sm" />
          </Card>
          <Card>
            <p className="text-xs font-medium text-slate-500 mb-1">Requirement Match</p>
            <p className="text-2xl font-bold text-slate-900 mb-2">{coveredCount}/{requirementCoverage.length}</p>
            <ProgressBar value={coveredCount} max={requirementCoverage.length} size="sm" />
          </Card>
        </div>

        {/* Keyword gaps */}
        <Card className="mb-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Keyword Analysis</h3>
          <div className="flex flex-wrap gap-2">
            {keywordGaps.map((kw) => (
              <span
                key={kw.keyword}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md ${
                  kw.found
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                {kw.found ? '✓' : '✗'} {kw.keyword}
                {kw.importance === 'high' && !kw.found && (
                  <Badge variant="error" size="sm">!</Badge>
                )}
              </span>
            ))}
          </div>
        </Card>

        {/* Requirements */}
        <Card className="mb-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Requirement Coverage</h3>
          <div className="space-y-3">
            {requirementCoverage.map((req, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  req.covered ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                }`}>
                  {req.covered ? '✓' : '✗'}
                </span>
                <div>
                  <p className="text-sm text-slate-700">{req.requirement}</p>
                  {req.suggestion && (
                    <p className="text-xs text-amber-700 mt-0.5">💡 {req.suggestion}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Before/After suggestions */}
        <Card>
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Suggested Improvements</h3>
          <div className="space-y-6">
            {suggestions.map((s, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="info" size="sm">{s.section}</Badge>
                  <span className="text-xs text-slate-500">{s.reason}</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                    <p className="text-xs font-medium text-red-700 mb-1">Before</p>
                    <p className="text-xs text-slate-700 leading-relaxed">{s.before}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                    <p className="text-xs font-medium text-emerald-700 mb-1">After</p>
                    <p className="text-xs text-slate-700 leading-relaxed">{s.after}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
