import { ResumeJSON } from '@/lib/mock-data';

export function ResumePreview({ resume }: { resume: ResumeJSON }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm max-w-2xl mx-auto">
      <div className="p-8 space-y-6">
        {/* Header */}
        <div className="text-center border-b border-slate-200 pb-6">
          <h1 className="text-2xl font-bold text-slate-900">{resume.contact.name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {resume.contact.email} · {resume.contact.phone} · {resume.contact.location}
            {resume.contact.linkedin && ` · ${resume.contact.linkedin}`}
          </p>
        </div>

        {/* Summary */}
        <div>
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Summary</h2>
          <p className="text-sm text-slate-700 leading-relaxed">{resume.summary}</p>
        </div>

        {/* Experience */}
        <div>
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Experience</h2>
          <div className="space-y-4">
            {resume.experience.map((exp, i) => (
              <div key={i}>
                <div className="flex justify-between items-baseline">
                  <h3 className="text-sm font-semibold text-slate-900">{exp.title}</h3>
                  <span className="text-xs text-slate-500 whitespace-nowrap ml-4">{exp.startDate} – {exp.endDate}</span>
                </div>
                <p className="text-sm text-slate-600">{exp.company}, {exp.location}</p>
                <ul className="mt-1.5 space-y-1">
                  {exp.bullets.map((b, j) => (
                    <li key={j} className="text-sm text-slate-700 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-slate-400">
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Education */}
        <div>
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Education</h2>
          {resume.education.map((edu, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-sm text-slate-700">{edu.degree}, {edu.school}</span>
              <span className="text-xs text-slate-500">{edu.year}</span>
            </div>
          ))}
        </div>

        {/* Skills */}
        <div>
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Skills</h2>
          <div className="flex flex-wrap gap-1.5">
            {resume.skills.map((skill) => (
              <span key={skill} className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded-md">
                {skill}
              </span>
            ))}
          </div>
        </div>

        {/* Certifications */}
        {resume.certifications && resume.certifications.length > 0 && (
          <div>
            <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Certifications</h2>
            <p className="text-sm text-slate-700">{resume.certifications.join(', ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
