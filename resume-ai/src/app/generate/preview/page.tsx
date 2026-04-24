import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ResumePreview } from '@/components/ResumePreview';
import { mockResume } from '@/lib/mock-data';
import Link from 'next/link';

export default function PreviewPage() {
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Resume Preview</h1>
            <p className="text-slate-500 text-sm">Generated from your questionnaire answers (mock data)</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="success">Generated</Badge>
            <Link
              href="/score"
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
            >
              Score this resume →
            </Link>
          </div>
        </div>

        <Card padding="sm" className="mb-6">
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <span>Format: <strong>ATS-Optimized</strong></span>
            <span className="text-slate-300">|</span>
            <span>Sections: <strong>6</strong></span>
            <span className="text-slate-300">|</span>
            <span>Word count: <strong>~320</strong></span>
          </div>
        </Card>

        <ResumePreview resume={mockResume} />
      </div>
    </AppShell>
  );
}
