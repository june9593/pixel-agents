'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ProgressBar } from '@/components/ProgressBar';
import type { ScoreResponse } from '@/lib/scorer/types';
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
  const [result, setResult] = useState<ScoreResponse | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('scoreResult');
    if (stored) {
      setResult(JSON.parse(stored));
    }
  }, []);

  if (!result) {
    return (
      <AppShell>
        <div className="max-w-3xl mx-auto text-center py-16">
          <p className="text-slate-500 mb-4">No score results found. Score a resume first.</p>
          <Link href="/score" className="text-indigo-600 hover:text-indigo-700 font-medium text-sm">
            Go to Score page
          </Link>
        </div>
      </AppShell>
    );
  }

  const { overall, categories, summary, topStrengths, topImprovements } = result;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Score Results</h1>
            <p className="text-slate-500 text-sm">Detailed breakdown by rubric category</p>
          </div>
          <Link
            href="/score"
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            Score another
          </Link>
        </div>

        <Card className="mb-6">
          <div className="flex items-center justify-center py-4">
            <ScoreRing score={overall} label="Overall Score" />
          </div>
          <p className="text-sm text-slate-600 text-center mt-2 max-w-lg mx-auto">{summary}</p>
        </Card>

        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <Card>
            <h3 className="text-sm font-semibold text-emerald-800 mb-3">Top Strengths</h3>
            <ul className="space-y-2">
              {topStrengths.map((s, i) => (
                <li key={i} className="text-sm text-slate-700 pl-4 relative before:content-['+'] before:absolute before:left-0 before:text-emerald-500 before:font-bold">
                  {s}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold text-amber-800 mb-3">Top Improvements</h3>
            <ul className="space-y-2">
              {topImprovements.map((s, i) => (
                <li key={i} className="text-sm text-slate-700 pl-4 relative before:content-['!'] before:absolute before:left-0 before:text-amber-500 before:font-bold">
                  {s}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid gap-4 mb-6">
          {categories.map((cat) => (
            <Card key={cat.category}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900">{cat.label}</h3>
                <span className="text-sm font-bold text-slate-700 tabular-nums">{cat.score}/{cat.maxScore}</span>
              </div>
              <ProgressBar value={cat.score} max={cat.maxScore} size="sm" showLabel />

              <p className="text-sm text-slate-600 mt-3">{cat.rationale}</p>

              <div className="grid sm:grid-cols-2 gap-4 mt-4">
                {cat.evidence.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-2">Evidence</p>
                    <ul className="space-y-1">
                      {cat.evidence.map((e, i) => (
                        <li key={i} className="text-xs text-slate-600 pl-3 relative">
                          <Badge variant="info" size="sm">cite</Badge>{' '}
                          <span className="italic">{e}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {cat.suggestions.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-amber-700 mb-2">Suggestions</p>
                    <ul className="space-y-1">
                      {cat.suggestions.map((s, i) => (
                        <li key={i} className="text-xs text-slate-600 pl-3 relative before:content-['→'] before:absolute before:left-0 before:text-amber-500">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
