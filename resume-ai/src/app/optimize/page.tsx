'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { ResumePreview } from '@/components/ResumePreview';
import { mockResume, mockJobDescription } from '@/lib/mock-data';

export default function OptimizePage() {
  const router = useRouter();
  const [showJd, setShowJd] = useState(false);

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Optimize Resume</h1>
          <p className="text-slate-500">Review your parsed resume against a target job description and get AI-powered optimization suggestions.</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">Parsed Resume (Mock)</h2>
            </div>
            <ResumePreview resume={mockResume} />
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Target Job Description</h2>
                <button
                  onClick={() => setShowJd(!showJd)}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  {showJd ? 'Hide' : 'Show'}
                </button>
              </div>
              {showJd && (
                <pre className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                  {mockJobDescription}
                </pre>
              )}
              {!showJd && (
                <p className="text-xs text-slate-500">Senior Full-Stack Engineer — FinTech Startup</p>
              )}
            </Card>

            <div className="flex justify-end">
              <Button size="lg" onClick={() => router.push('/optimize/results')}>
                Analyze & Optimize
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
