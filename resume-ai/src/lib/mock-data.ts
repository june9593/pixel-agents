export interface ResumeJSON {
  contact: {
    name: string;
    email: string;
    phone: string;
    location: string;
    linkedin?: string;
  };
  summary: string;
  experience: {
    title: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string;
    bullets: string[];
  }[];
  education: {
    degree: string;
    school: string;
    year: string;
  }[];
  skills: string[];
  certifications?: string[];
}

export interface ScoreResult {
  overall: number;
  pillars: {
    name: string;
    score: number;
    maxScore: number;
    helped: string[];
    hurt: string[];
  }[];
  highlights: {
    text: string;
    type: 'positive' | 'negative' | 'neutral';
  }[];
}

export interface OptimizationResult {
  keywordGaps: { keyword: string; importance: 'high' | 'medium' | 'low'; found: boolean }[];
  requirementCoverage: { requirement: string; covered: boolean; suggestion?: string }[];
  suggestions: { section: string; before: string; after: string; reason: string }[];
}

export const mockResume: ResumeJSON = {
  contact: {
    name: 'Alex Chen',
    email: 'alex.chen@email.com',
    phone: '(555) 123-4567',
    location: 'San Francisco, CA',
    linkedin: 'linkedin.com/in/alexchen',
  },
  summary:
    'Senior Software Engineer with 6+ years of experience building scalable web applications. Proficient in React, TypeScript, Node.js, and cloud infrastructure. Led cross-functional teams delivering products serving 2M+ users.',
  experience: [
    {
      title: 'Senior Software Engineer',
      company: 'TechCorp Inc.',
      location: 'San Francisco, CA',
      startDate: 'Jan 2022',
      endDate: 'Present',
      bullets: [
        'Led migration of monolithic application to microservices architecture, reducing deployment time by 70%',
        'Designed and implemented real-time data pipeline processing 500K events/day using Kafka and Redis',
        'Mentored 4 junior engineers through code reviews and pair programming sessions',
        'Collaborated with product and design teams to ship 3 major features ahead of schedule',
      ],
    },
    {
      title: 'Software Engineer',
      company: 'StartupXYZ',
      location: 'San Francisco, CA',
      startDate: 'Jun 2019',
      endDate: 'Dec 2021',
      bullets: [
        'Built customer-facing dashboard used by 50K+ monthly active users with React and GraphQL',
        'Implemented CI/CD pipeline reducing release cycle from 2 weeks to 2 days',
        'Optimized database queries resulting in 40% improvement in API response times',
      ],
    },
    {
      title: 'Junior Developer',
      company: 'WebAgency Co.',
      location: 'Oakland, CA',
      startDate: 'Aug 2017',
      endDate: 'May 2019',
      bullets: [
        'Developed responsive web applications for 15+ client projects using React and Node.js',
        'Integrated third-party APIs including Stripe, Twilio, and SendGrid',
      ],
    },
  ],
  education: [
    {
      degree: 'B.S. Computer Science',
      school: 'UC Berkeley',
      year: '2017',
    },
  ],
  skills: [
    'TypeScript', 'React', 'Node.js', 'Python', 'PostgreSQL', 'Redis',
    'AWS', 'Docker', 'Kubernetes', 'GraphQL', 'Kafka', 'CI/CD',
  ],
  certifications: ['AWS Solutions Architect Associate'],
};

export const mockJobDescription = `Senior Full-Stack Engineer — FinTech Startup

We're looking for a Senior Full-Stack Engineer to join our growing team building the next generation of payment infrastructure.

Requirements:
- 5+ years of software engineering experience
- Strong proficiency in TypeScript and React
- Experience with Node.js and RESTful API design
- Familiarity with cloud platforms (AWS preferred)
- Experience with relational databases (PostgreSQL)
- Understanding of microservices architecture
- Experience with payment systems or financial technology is a plus
- Strong communication skills and ability to work in cross-functional teams

Nice to have:
- Experience with Kubernetes and container orchestration
- Knowledge of event-driven architectures (Kafka, RabbitMQ)
- Experience with GraphQL
- Familiarity with compliance/security standards (PCI-DSS, SOC2)`;

export const mockScoreResult: ScoreResult = {
  overall: 78,
  pillars: [
    {
      name: 'Technical Skills Match',
      score: 85,
      maxScore: 100,
      helped: [
        'TypeScript and React listed as primary skills',
        'AWS certification demonstrates cloud expertise',
        'PostgreSQL and microservices experience mentioned',
      ],
      hurt: [
        'No mention of payment systems or FinTech domain experience',
        'REST API experience not explicitly called out',
      ],
    },
    {
      name: 'Experience & Impact',
      score: 82,
      maxScore: 100,
      helped: [
        'Quantified achievements (70% deployment reduction, 500K events/day)',
        'Progressive career growth from Junior to Senior',
        'Leadership experience mentoring team members',
      ],
      hurt: [
        'No FinTech or financial services industry experience visible',
      ],
    },
    {
      name: 'Communication & Soft Skills',
      score: 72,
      maxScore: 100,
      helped: [
        'Cross-functional collaboration mentioned',
        'Mentoring experience shows leadership',
      ],
      hurt: [
        'Summary could be more targeted to FinTech role',
        'No mention of written communication or documentation skills',
      ],
    },
    {
      name: 'ATS Keyword Coverage',
      score: 68,
      maxScore: 100,
      helped: [
        'Core tech stack keywords present (TypeScript, React, Node.js, AWS)',
        'Kubernetes and Docker mentioned as nice-to-haves',
      ],
      hurt: [
        'Missing: "payment systems", "FinTech", "RESTful API"',
        'Missing: compliance/security terms (PCI-DSS, SOC2)',
        '"Full-stack" not used despite matching experience',
      ],
    },
  ],
  highlights: [
    { text: 'Led migration of monolithic application to microservices architecture', type: 'positive' },
    { text: 'processing 500K events/day using Kafka and Redis', type: 'positive' },
    { text: 'Mentored 4 junior engineers', type: 'positive' },
    { text: 'No FinTech / payments domain language anywhere in resume', type: 'negative' },
    { text: '"RESTful API" not mentioned despite likely having experience', type: 'negative' },
    { text: 'Summary is generic — not tailored to target role', type: 'neutral' },
  ],
};

export const mockOptimizationResult: OptimizationResult = {
  keywordGaps: [
    { keyword: 'Full-Stack Engineer', importance: 'high', found: false },
    { keyword: 'payment systems', importance: 'high', found: false },
    { keyword: 'RESTful API', importance: 'high', found: false },
    { keyword: 'FinTech', importance: 'medium', found: false },
    { keyword: 'PCI-DSS', importance: 'low', found: false },
    { keyword: 'SOC2', importance: 'low', found: false },
    { keyword: 'TypeScript', importance: 'high', found: true },
    { keyword: 'React', importance: 'high', found: true },
    { keyword: 'Node.js', importance: 'high', found: true },
    { keyword: 'AWS', importance: 'high', found: true },
    { keyword: 'PostgreSQL', importance: 'medium', found: true },
    { keyword: 'microservices', importance: 'medium', found: true },
    { keyword: 'Kubernetes', importance: 'low', found: true },
    { keyword: 'Kafka', importance: 'low', found: true },
    { keyword: 'GraphQL', importance: 'low', found: true },
  ],
  requirementCoverage: [
    { requirement: '5+ years of software engineering experience', covered: true },
    { requirement: 'Strong proficiency in TypeScript and React', covered: true },
    { requirement: 'Experience with Node.js and RESTful API design', covered: false, suggestion: 'Add "RESTful API" to skills and mention API design in experience bullets' },
    { requirement: 'Familiarity with cloud platforms (AWS preferred)', covered: true },
    { requirement: 'Experience with relational databases (PostgreSQL)', covered: true },
    { requirement: 'Understanding of microservices architecture', covered: true },
    { requirement: 'Payment systems or financial technology experience', covered: false, suggestion: 'If applicable, mention any payment integration work (e.g., Stripe)' },
    { requirement: 'Strong communication skills', covered: true },
  ],
  suggestions: [
    {
      section: 'Summary',
      before: 'Senior Software Engineer with 6+ years of experience building scalable web applications.',
      after: 'Senior Full-Stack Engineer with 6+ years of experience building scalable web applications and API-driven platforms. Proven track record in payment integrations and high-throughput data systems.',
      reason: 'Adds "Full-Stack" keyword, references API work and payment integrations to match JD',
    },
    {
      section: 'Experience — TechCorp bullet 2',
      before: 'Designed and implemented real-time data pipeline processing 500K events/day using Kafka and Redis',
      after: 'Designed and implemented real-time data pipeline and RESTful APIs processing 500K events/day using Kafka, Redis, and Node.js',
      reason: 'Adds "RESTful APIs" keyword naturally into an existing strong bullet',
    },
    {
      section: 'Experience — StartupXYZ bullet 1',
      before: 'Built customer-facing dashboard used by 50K+ monthly active users with React and GraphQL',
      after: 'Built full-stack customer-facing dashboard with integrated payment flows, used by 50K+ MAU, using React, GraphQL, and Stripe',
      reason: 'Adds payment/FinTech context and "full-stack" keyword if Stripe was actually used',
    },
    {
      section: 'Skills',
      before: 'TypeScript, React, Node.js, Python, PostgreSQL, Redis, AWS, Docker, Kubernetes, GraphQL, Kafka, CI/CD',
      after: 'TypeScript, React, Node.js, Python, PostgreSQL, Redis, AWS, Docker, Kubernetes, GraphQL, Kafka, CI/CD, RESTful APIs, Payment Integration, Stripe',
      reason: 'Adds missing high-value keywords for ATS matching',
    },
  ],
};

export const mockQuestions = [
  {
    id: 'q1',
    section: 'Professional Background',
    question: 'What is your most recent job title and company?',
    placeholder: 'e.g., Senior Software Engineer at TechCorp',
    type: 'text' as const,
  },
  {
    id: 'q2',
    section: 'Professional Background',
    question: 'How many years of professional experience do you have?',
    placeholder: 'e.g., 6 years',
    type: 'text' as const,
  },
  {
    id: 'q3',
    section: 'Technical Skills',
    question: 'What are your primary programming languages and frameworks?',
    placeholder: 'e.g., TypeScript, React, Node.js, Python',
    type: 'textarea' as const,
  },
  {
    id: 'q4',
    section: 'Achievements',
    question: 'Describe your most impactful project or achievement in your current/recent role.',
    placeholder: 'e.g., Led the migration of a monolithic app to microservices, reducing deployment time by 70%',
    type: 'textarea' as const,
  },
  {
    id: 'q5',
    section: 'Achievements',
    question: 'Can you quantify the results of your work? (users served, performance gains, revenue impact)',
    placeholder: 'e.g., Served 2M+ users, processed 500K events/day, improved API response times by 40%',
    type: 'textarea' as const,
  },
  {
    id: 'q6',
    section: 'Education & Certifications',
    question: 'What is your highest level of education and any relevant certifications?',
    placeholder: 'e.g., B.S. Computer Science, UC Berkeley; AWS Solutions Architect',
    type: 'textarea' as const,
  },
  {
    id: 'q7',
    section: 'Target Role',
    question: 'What type of role are you targeting? Any specific industry or company size preference?',
    placeholder: 'e.g., Senior Full-Stack Engineer at a mid-stage FinTech startup',
    type: 'textarea' as const,
  },
];

export const mockAnswers: Record<string, string> = {
  q1: 'Senior Software Engineer at TechCorp Inc.',
  q2: '6 years',
  q3: 'TypeScript, React, Node.js, Python, PostgreSQL, Redis, AWS, Docker, Kubernetes, GraphQL, Kafka',
  q4: 'Led the migration of a monolithic application to a microservices architecture. This reduced deployment time by 70% and enabled the team to ship features independently. Also designed a real-time data pipeline processing 500K events/day.',
  q5: 'Products I built serve 2M+ users. Optimized database queries for 40% faster API response times. Mentored 4 junior engineers. Shipped 3 major features ahead of schedule.',
  q6: 'B.S. Computer Science from UC Berkeley (2017). AWS Solutions Architect Associate certification.',
  q7: 'Targeting Senior Full-Stack or Staff-level roles at growth-stage startups, preferably in FinTech or developer tools.',
};

export const targetRoles = [
  'Software Engineer',
  'Full-Stack Engineer',
  'Frontend Engineer',
  'Backend Engineer',
  'DevOps Engineer',
  'Data Engineer',
  'Engineering Manager',
  'Product Manager',
  'Designer',
];

export const experienceLevels = [
  'Entry Level (0-2 years)',
  'Mid Level (3-5 years)',
  'Senior (5-8 years)',
  'Staff / Principal (8+ years)',
  'Management / Leadership',
];
