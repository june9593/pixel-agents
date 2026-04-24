import { ReactNode } from 'react';
import Link from 'next/link';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-indigo-600">
                <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
                <path d="M7 8h10M7 12h7M7 16h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Resume AI
            </Link>
            <div className="flex items-center gap-1">
              <Link href="/generate" className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors">
                Generate
              </Link>
              <Link href="/score" className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors">
                Score
              </Link>
              <Link href="/optimize" className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors">
                Optimize
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
