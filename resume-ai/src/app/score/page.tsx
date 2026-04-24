'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';

export default function ScorePage() {
  const router = useRouter();
  const [resumeText, setResumeText] = useState('');
  const [jdText, setJdText] = useState('');

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Score Your Resume</h1>
          <p className="text-slate-500">Paste your resume and a target job description to get a detailed score breakdown.</p>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <label htmlFor="resume" className="block text-sm font-semibold text-slate-900">
                Your Resume
              </label>
              <button
                onClick={() => setResumeText('(Mock resume pasted — see results for demo data)')}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Paste demo resume
              </button>
            </div>
            <textarea
              id="resume"
              rows={6}
              placeholder="Paste your resume text here, or upload a file..."
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Upload PDF (mocked)
              </button>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <label htmlFor="jd" className="block text-sm font-semibold text-slate-900">
                Target Job Description
              </label>
              <button
                onClick={() => setJdText('(Mock JD pasted — see results for demo data)')}
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

          <div className="flex justify-end">
            <Button
              size="lg"
              disabled={!resumeText && !jdText}
              onClick={() => router.push('/score/results')}
            >
              Score Resume
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
