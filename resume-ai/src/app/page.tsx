import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';

const flows = [
  {
    title: 'Generate Resume',
    description: 'Create a polished, ATS-optimized resume from scratch by answering structured questions about your experience and goals.',
    href: '/generate',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-indigo-600">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    color: 'border-l-indigo-500',
  },
  {
    title: 'Score Resume',
    description: 'Paste an existing resume and a target job description to get a detailed score breakdown with actionable feedback.',
    href: '/score',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-emerald-600">
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    color: 'border-l-emerald-500',
  },
  {
    title: 'Optimize Resume',
    description: 'Analyze your resume against a specific job description to identify keyword gaps and get AI-powered improvement suggestions.',
    href: '/optimize',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-amber-600">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    color: 'border-l-amber-500',
  },
];

export default function HomePage() {
  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-slate-900 mb-3">Resume AI</h1>
          <p className="text-lg text-slate-500 max-w-lg mx-auto">
            Generate, score, and optimize your resume with AI-powered tools designed for ATS compatibility.
          </p>
        </div>

        <div className="space-y-4">
          {flows.map((flow) => (
            <Link key={flow.href} href={flow.href}>
              <Card className={`border-l-4 ${flow.color} hover:shadow-md transition-shadow cursor-pointer`}>
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-0.5">{flow.icon}</div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 mb-1">{flow.title}</h2>
                    <p className="text-sm text-slate-500 leading-relaxed">{flow.description}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
