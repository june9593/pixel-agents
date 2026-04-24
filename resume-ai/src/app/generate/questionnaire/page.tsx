'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { ProgressBar } from '@/components/ProgressBar';
import { mockQuestions, mockAnswers } from '@/lib/mock-data';

export default function QuestionnairePage() {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(mockAnswers);
  const [currentSection, setCurrentSection] = useState(0);

  const sections = [...new Set(mockQuestions.map((q) => q.section))];
  const currentQuestions = mockQuestions.filter((q) => q.section === sections[currentSection]);
  const filledCount = Object.values(answers).filter(Boolean).length;

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Questionnaire</h1>
          <p className="text-slate-500 text-sm mb-4">
            Answer these questions to generate a tailored resume. Pre-filled with example answers.
          </p>
          <ProgressBar value={filledCount} max={mockQuestions.length} showLabel />
        </div>

        <div className="flex gap-2 mb-6">
          {sections.map((section, i) => (
            <button
              key={section}
              onClick={() => setCurrentSection(i)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                i === currentSection
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {section}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {currentQuestions.map((q) => (
            <Card key={q.id}>
              <label htmlFor={q.id} className="block text-sm font-medium text-slate-900 mb-2">
                {q.question}
              </label>
              {q.type === 'textarea' ? (
                <textarea
                  id={q.id}
                  rows={3}
                  placeholder={q.placeholder}
                  value={answers[q.id] || ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                />
              ) : (
                <input
                  id={q.id}
                  type="text"
                  placeholder={q.placeholder}
                  value={answers[q.id] || ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              )}
            </Card>
          ))}
        </div>

        <div className="flex justify-between mt-8">
          <Button
            variant="secondary"
            disabled={currentSection === 0}
            onClick={() => setCurrentSection(currentSection - 1)}
          >
            Previous
          </Button>
          {currentSection < sections.length - 1 ? (
            <Button onClick={() => setCurrentSection(currentSection + 1)}>
              Next Section
            </Button>
          ) : (
            <Button onClick={() => router.push('/generate/preview')}>
              Generate Resume
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
