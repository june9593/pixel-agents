'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { targetRoles, experienceLevels } from '@/lib/mock-data';

export default function GeneratePage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Generate Resume</h1>
          <p className="text-slate-500">Select your target role and experience level to begin.</p>
        </div>

        <div className="space-y-8">
          <Card>
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Target Role</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {targetRoles.map((role) => (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                    selectedRole === role
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium'
                      : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Experience Level</h2>
            <div className="space-y-2">
              {experienceLevels.map((level) => (
                <button
                  key={level}
                  onClick={() => setSelectedLevel(level)}
                  className={`w-full px-4 py-3 text-sm rounded-lg border transition-colors text-left ${
                    selectedLevel === level
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium'
                      : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </Card>

          <div className="flex justify-end">
            <Button
              size="lg"
              disabled={!selectedRole || !selectedLevel}
              onClick={() => router.push('/generate/questionnaire')}
            >
              Continue to Questionnaire
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
