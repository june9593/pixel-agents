'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { mockResume, mockJobDescription } from '@/lib/mock-data';
import type { ResumeJSON } from '@/lib/mock-data';

export default function ScorePage() {
  const router = useRouter();
  const [resumeText, setResumeText] = useState('');
  const [jdText, setJdText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScore() {
    setError(null);
    setLoading(true);

    let resume: ResumeJSON;
    try {
      resume = JSON.parse(resumeText);
    } catch {
      setError('Resume must be valid JSON. Use "Paste demo resume" for an example.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume,
          ...(jdText.trim() ? { jobDescription: jdText.trim() } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Scoring failed' }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      sessionStorage.setItem('scoreResult', JSON.stringify(result));
      router.push('/score/results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scoring failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Score Your Resume</h1>
          <p className="text-slate-500">
            Paste your resume as JSON and an optional target job description to get a detailed score breakdown.
          </p>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <label htmlFor="resume" className="block text-sm font-semibold text-slate-900">
                Resume JSON
              </label>
              <button
                onClick={() => setResumeText(JSON.stringify(mockResume, null, 2))}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Paste demo resume
              </button>
            </div>
            <textarea
              id="resume"
              rows={8}
              placeholder='{"contact": {"name": "..."}, "summary": "...", ...}'
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <label htmlFor="jd" className="block text-sm font-semibold text-slate-900">
                Target Job Description <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <button
                onClick={() => setJdText(mockJobDescription)}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Paste demo JD
              </button>
            </div>
            <textarea
              id="jd"
              rows={6}
              placeholder="Paste the job description you want to score against..."
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </Card>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button size="lg" disabled={!resumeText.trim() || loading} onClick={handleScore}>
              {loading ? 'Scoring...' : 'Score Resume'}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
