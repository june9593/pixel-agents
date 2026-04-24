import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ProgressBar } from '@/components/ProgressBar';
import { mockScoreResult } from '@/lib/mock-data';
import Link from 'next/link';

function ScoreRing({ score, label }: { score: number; label: string }) {
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#059669' : score >= 60 ? '#d97706' : '#dc2626';

  return (
    <div className="flex flex-col items-center">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle
          cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="50" textAnchor="middle" dy="0.35em" className="text-2xl font-bold" fill="#0f172a">
          {score}
        </text>
      </svg>
      <span className="text-sm font-medium text-slate-700 mt-1">{label}</span>
    </div>
  );
}

export default function ScoreResultsPage() {
  const { overall, pillars, highlights } = mockScoreResult;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Score Results</h1>
            <p className="text-slate-500 text-sm">Detailed breakdown against target job description</p>
          </div>
          <Link
            href="/optimize"
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            Optimize this resume →
          </Link>
        </div>

        <Card className="mb-6">
          <div className="flex items-center justify-center py-4">
            <ScoreRing score={overall} label="Overall Score" />
          </div>
        </Card>

        <div className="grid gap-4 mb-6">
          {pillars.map((pillar) => (
            <Card key={pillar.name}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900">{pillar.name}</h3>
                <span className="text-sm font-bold text-slate-700 tabular-nums">{pillar.score}/{pillar.maxScore}</span>
              </div>
              <ProgressBar value={pillar.score} max={pillar.maxScore} size="sm" showLabel />

              <div className="grid sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-xs font-medium text-emerald-700 mb-2">What helped</p>
                  <ul className="space-y-1">
                    {pillar.helped.map((h, i) => (
                      <li key={i} className="text-xs text-slate-600 pl-3 relative before:content-['+'] before:absolute before:left-0 before:text-emerald-500 before:font-bold">
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-red-700 mb-2">What hurt</p>
                  <ul className="space-y-1">
                    {pillar.hurt.map((h, i) => (
                      <li key={i} className="text-xs text-slate-600 pl-3 relative before:content-['−'] before:absolute before:left-0 before:text-red-500 before:font-bold">
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card>
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Resume Highlights</h3>
          <div className="space-y-2">
            {highlights.map((hl, i) => (
              <div key={i} className="flex items-start gap-2">
                <Badge
                  variant={hl.type === 'positive' ? 'success' : hl.type === 'negative' ? 'error' : 'default'}
                  size="sm"
                >
                  {hl.type === 'positive' ? '✓' : hl.type === 'negative' ? '✗' : '—'}
                </Badge>
                <span className="text-sm text-slate-700">{hl.text}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
