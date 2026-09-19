/* ============================================================================
   resume.js — the CV as DATA, not as a document.

   One structured source of truth for every fact about Jayesh. Three things
   consume it and therefore can never drift apart:

     make-pdf.js   → jayesh-deshmukh-resume.pdf   (the download)
     make-pdf.js   → jayesh-deshmukh-resume.txt   (the ATS-safe plain text)
     build.js      → index.html                   (the page + the paper preview)

   Edit a bullet here, run `npm run build`, and the page, the PDF and the text
   file all change together. Nothing is typed twice.

   Nothing in here is presentation: no fonts, no pixels, no colours. That is
   make-pdf.js's job, and build.js's job is different again.
   ========================================================================== */

export const PERSON = {
  name: 'Jayesh Deshmukh',
  first: 'Jayesh',
  sig: 'jayesh',
  headline: 'Software Developer · Microsoft Dynamics 365 & Azure Integration',
  role: 'Software Developer',
  focus: 'Dynamics 365 CRM · Azure Functions · Power Platform',
  place: 'Pune, Maharashtra, India',
  city: 'Pune, India',
  phone: '+91 98811 59380',
  phoneHref: '+919881159380',
  email: 'jdeshmukh521@gmail.com',
  linkedin: 'https://linkedin.com/in/jdz777',
  linkedinLabel: 'linkedin.com/in/jdz777',
  years: '3+ years',
  availability: 'Open to Senior D365 / Power Platform roles',
  // Drop a photo at portfolio/assets/jayesh.jpg (see README) — build.js picks
  // it up automatically. Until then the inked monogram stands in.
  photo: null,
  photoAlt: 'Jayesh Deshmukh'
};

export const SUMMARY =
  'Results-driven Software Developer with 3+ years of enterprise software development experience, ' +
  'specializing in Microsoft Dynamics 365 CRM, cloud integration, and scalable enterprise solutions. ' +
  'Proven track record of leading end-to-end CRM implementations, building complex API integrations, ' +
  'and delivering high-impact automation solutions that optimize business processes and operational ' +
  'efficiency.';

/* Six groups, in the order a D365 hiring manager scans them. */
export const SKILLS = [
  { group: 'Languages', items: ['C#', 'JavaScript', 'TypeScript', 'SQL', 'Python'] },
  { group: 'Frameworks & Technologies', items: ['.NET Core', 'Azure Functions', 'Power Platform (Power BI, Power Apps, Power Automate)'] },
  { group: 'Cloud & DevOps', items: ['Microsoft Azure', 'Azure DevOps', 'CI/CD Pipelines', 'Solution Deployments'] },
  { group: 'CRM & ERP', items: ['Microsoft Dynamics 365 (Sales, Marketing, Project Operations)', 'SAP Integration'] },
  { group: 'Development Tools', items: ['Plugin Development', 'Ribbon Workbench', 'REST/SOAP APIs', 'MySQL', 'Git'] },
  { group: 'Methodologies', items: ['Agile/Scrum', 'SAFe 6', 'Requirements Gathering', 'Stakeholder Management'] }
];

/* Flat list, for the on-page "kit" and the plain-text export. */
export const SKILL_GROUPS = SKILLS;

export const EXPERIENCE = [
  {
    id: 'siemens',
    company: 'Siemens Technology and Services Private Limited',
    short: 'Siemens',
    role: 'Software Developer',
    when: 'March 2024 – Present',
    from: '2024-03',
    to: null,
    place: 'Pune, India',
    current: true,
    kicker: 'D365 Project Operations',
    sub: 'enterprise project management, at scale',
    tags: ['Dynamics 365', 'Project Operations', 'Power BI', 'Power Apps', 'Azure DevOps', 'C#'],
    art: 'grid',
    bullets: [
      'Contributing to end-to-end implementation of Dynamics 365 Project Operations, collaborating with business stakeholders to build scalable project management solutions and optimize workflows.',
      'Architected and developed comprehensive CRM customizations for Sales and Marketing modules using plugins (C#), JavaScript, Power Automate, and Ribbon Workbench, improving user productivity by 40%.',
      'Built custom Power BI dashboards and Power Apps solutions integrated with D365 CRM, providing real-time analytics and business insights to executive leadership.',
      'Managed solution deployments across multiple environments (Dev, QA, Production) with zero downtime, implementing CI/CD best practices using Azure DevOps.',
      'Collaborated directly with business owners to gather requirements, translate business needs into technical specifications, and deliver solutions aligned with organizational goals.'
    ],
    note: '500+ users across multiple business units.'
  },
  {
    id: 'ust',
    company: 'UST (Pragmasys LLP)',
    short: 'UST',
    role: 'MS D365 CRM Developer — Enterprise Solutions',
    when: 'August 2022 – March 2024',
    from: '2022-08',
    to: '2024-03',
    place: 'Pune, India',
    current: false,
    kicker: 'CRM ↔ SAP integration',
    sub: '10,000 records a day, no hands',
    tags: ['Azure Functions', 'SAP APIs', 'D365 CRM', 'Power Automate', 'REST/SOAP', 'C#'],
    art: 'route',
    bullets: [
      'Designed and implemented scalable Azure Function Apps to orchestrate API integrations between Dynamics 365 CRM and SAP ERP, enabling real-time data synchronization for 10,000+ records daily.',
      'Developed custom plugins and JavaScript solutions for complex business workflows, reducing manual data entry time by 60% through automation.',
      'Successfully consumed and integrated SAP APIs with D365 CRM, creating seamless enterprise system connectivity and improving operational efficiency by 35%.',
      'Built automated workflows using Power Automate to streamline approval processes and notifications, reducing processing time from days to hours.',
      'Collaborated with cross-functional teams to deliver cloud-based CRM solutions, ensuring high availability and performance optimization.'
    ],
    note: 'SAP + D365, speaking to each other in real time.'
  },
  {
    id: 'assetcues',
    company: 'AssetCues',
    short: 'AssetCues',
    role: '.NET Developer',
    when: 'February 2022 – August 2022',
    from: '2022-02',
    to: '2022-08',
    place: 'Pune, India',
    current: false,
    kicker: 'Full-stack foundations',
    sub: 'APIs, MySQL, and code review',
    tags: ['.NET Core', 'REST APIs', 'MySQL', 'Full-stack'],
    art: 'puzzle',
    bullets: [
      'Developed full-stack web applications using .NET Core, implementing RESTful APIs and database solutions with MySQL.',
      'Contributed to application architecture decisions and code reviews, maintaining high code quality standards.',
      'Collaborated with product teams to deliver customer-facing features on tight deadlines.'
    ],
    note: 'Where the fundamentals got built.'
  }
];

export const EDUCATION = [
  {
    degree: 'Master of Computer Applications (MCA) — Computer Programming',
    school: 'Department of Computer Science, Pune University',
    place: 'Pune, India',
    when: '2020 – 2022',
    art: 'cap'
  }
];

export const CERTIFICATIONS = [
  { name: 'Certified SAFe 6 Practitioner', org: 'Scaled Agile Framework' },
  { name: 'C# .NET Core with Real World Examples', org: 'Applied Software Development' }
];

export const ACHIEVEMENTS = [
  'Contributing to D365 Project Operations implementation serving 500+ users across multiple business units.',
  'Reduced system integration errors by 75% through robust error handling and automated testing framework.'
];

/* The metrics strip on the page — each one traceable to a bullet above. */
export const STATS = [
  { n: '3+', label: 'years building enterprise software', src: 'experience' },
  { n: '500+', label: 'users on the D365 platform I help build', src: 'achievements' },
  { n: '10k', label: 'records synced daily, CRM ↔ SAP', src: 'experience' },
  { n: '75%', label: 'fewer integration errors after hardening', src: 'achievements' },
  { n: '40%', label: 'productivity gain from CRM customisations', src: 'experience' },
  { n: '60%', label: 'less manual data entry, through automation', src: 'experience' }
];

/* Suggested filename stem. */
export const FILE_STEM = 'Jayesh-Deshmukh-Resume';
