'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { ResumePreview } from '@/components/ResumePreview';
import type { ResumeJSON } from '@/lib/mock-data';

type Step = 'upload' | 'parsing' | 'review';

const ACCEPTED_EXTENSIONS = '.txt,.pdf,.docx';

export default function OptimizePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [resume, setResume] = useState<ResumeJSON | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileUpload = async (file: File) => {
    setError(null);
    setFileName(file.name);
    setStep('parsing');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/parse/resume', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Upload failed');
      }

      const data = await res.json();
      setResume(data.resume);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse resume');
      setStep('upload');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };

  if (step === 'upload' || step === 'parsing') {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Optimize Resume</h1>
            <p className="text-slate-500">Upload your resume to get AI-powered optimization suggestions.</p>
          </div>

          <Card>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-indigo-400 transition-colors"
            >
              {step === 'parsing' ? (
                <div className="space-y-3">
                  <div className="animate-spin h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full mx-auto" />
                  <p className="text-sm text-slate-600">Parsing {fileName}...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-4xl text-slate-400">📄</div>
                  <p className="text-sm font-medium text-slate-700">
                    Drop your resume here, or{' '}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-indigo-600 hover:text-indigo-700 underline"
                    >
                      browse files
                    </button>
                  </p>
                  <p className="text-xs text-slate-400">Supports .txt, .pdf, and .docx</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </Card>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Optimize Resume</h1>
              <p className="text-slate-500">Review your parsed resume against a target job description.</p>
            </div>
            <Button
              size="sm"
              onClick={() => { setStep('upload'); setResume(null); setError(null); }}
            >
              Upload Different File
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">Parsed Resume</h2>
              {fileName && <span className="text-xs text-slate-400">{fileName}</span>}
            </div>
            {resume && <ResumePreview resume={resume} />}
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Target Job Description</h2>
              <textarea
                placeholder="Paste the job description here..."
                className="w-full h-32 text-xs border border-slate-200 rounded-lg p-3 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
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
