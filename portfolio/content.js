/* ============================================================================
   content.js — every word, link and drawing on the page lives here.
   Swap the person, the projects or the art without touching a single style.
   ========================================================================== */

export const ME = {
  name: 'Krishna Thorat',
  sig: 'krishna',
  role: 'Full-stack developer & AI engineer',
  place: 'Pune, India',
  email: 'krishnathorat007@gmail.com',
  resume: '/krishna-thorat-resume.pdf',
  socials: [
    { label: 'GitHub', href: 'https://github.com/gamentionkray' },
    { label: 'LinkedIn', href: 'https://linkedin.com/in/krishnathorat' },
    { label: 'Résumé', href: '/krishna-thorat-resume.pdf' }
  ]
};

export const HERO = {
  kicker: ['portfolio', 'v5 · built from scratch'],
  // Words get split and rise in one by one. {chaos:true} makes a word clickable.
  title: [
    { t: 'Serious ' },
    { t: 'code. ' },
    { t: 'Curious ' },
    { t: 'mind. ' },
    { t: 'A ' },
    { t: 'little ', chaos: true },
    { t: 'chaos.' }
  ],
  lede: `<strong>${ME.role} in ${ME.place}.</strong> I turn "what if?" into things
         you can actually use — web apps, AI systems, and the messy bits in between.`,
  ctas: [
    { label: 'See the work', href: '#work', kind: 'solid', ico: '↓' },
    { label: 'Résumé', href: ME.resume, kind: 'ghost', ico: '↗' }
  ],
  hint: 'drag your finger through the ink ↝',
  shape: 'spark',
  shapeText: 'what if?'
};

export const TICKER = ['Sketch it', 'Build it', 'Ship it', 'Make it better', 'Delete half of it'];

export const PROJECTS = [
  {
    id: 'billo',
    name: 'Billo.',
    kicker: 'Money, sorted',
    sub: 'just send the bills. we\'ll do the math.',
    desc: 'Group-trip expense tracking that runs entirely on the phone. Snap a receipt or say "paid ₹800 cab for me and Rahul" — on-device OCR and a Hinglish parser turn it into a paise-exact ledger, then reduce the group to the fewest possible settlements. Ships as a PWA and an Android WebView with Play Billing.',
    tags: ['Vanilla JS', 'Tesseract WASM', 'PWA', 'Kotlin', 'Play Billing'],
    href: null,
    hrefLabel: 'In this repo → /Billo App V3',
    art: 'bill',
    note: '62 unit tests on the money math. Zero network calls.',
    flip: false
  },
  {
    id: 'myna',
    name: 'Myna.',
    kicker: 'Real-time AI coach',
    sub: 'an interview copilot you can run yourself',
    desc: 'Listens to your interview, transcribes live, detects each question, and streams an answer written in your voice from your own résumé. Then debriefs you: talk share, words per minute, filler rate, hedging, "I" vs "we", STAR coverage per question. Zero dependencies, nothing recorded server-side.',
    tags: ['Node (zero-dep)', 'Web Speech API', 'Whisper', 'SSE streaming', 'jsdom tests'],
    href: null,
    hrefLabel: 'In this repo → /myna',
    art: 'wave',
    note: '55 tests. Five surfaces: Setup · Live · Mock · Coding · Debrief.',
    flip: true
  },
  {
    id: 'cue',
    name: 'Cue.',
    kicker: 'AI interviews',
    sub: 'an AI that interviews you back',
    desc: 'A live video interview with an AI that watches, listens and scores. Candidates practise and get a report on content, delivery, body language and integrity. Employers screen and review.',
    tags: ['Next.js 16', 'LiveKit', 'Gemini Live'],
    href: 'https://interview.hire.rest/',
    hrefLabel: 'Open Cue',
    art: 'cue',
    note: null,
    flip: false
  },
  {
    id: 'pulse',
    name: 'Pulse.',
    kicker: 'Real-time collaboration',
    sub: 'collaboration in a few HTML tags',
    desc: 'Web components that add comment threads, live cursors, presence, reactions and shared data to any website. Self-hosted, framework-agnostic, no lock-in.',
    tags: ['Lit 3', 'WebSockets', 'Fastify', 'Redis'],
    href: 'https://pulse.hire.rest/',
    hrefLabel: 'Open Pulse',
    art: 'chat',
    note: null,
    flip: true
  },
  {
    id: 'ems',
    name: 'EMS.',
    kicker: 'Human resources',
    sub: 'payroll compliance, built in',
    desc: 'Multi-tenant HR for Indian companies with PF, ESI, PT and TDS handled. Onboarding, shift attendance, leave, and OKR performance reviews.',
    tags: ['Lit 3', 'Fastify', 'PostgreSQL', 'Docker'],
    href: 'https://ems.hire.rest/',
    hrefLabel: 'Open EMS',
    art: 'grid',
    note: null,
    flip: false
  }
];

export const BENCH = [
  { name: 'NexusLMS', desc: 'AI-native learning management: RAG tutor, eight question types, block course builder.', href: 'https://nexus.hire.rest/' },
  { name: 'TalentScan', desc: '16-agent career platform. Résumé analysis, interview prep, bulk screening, bring your own key.', href: 'https://talentscan.hire.rest/' },
  { name: 'MailCraft', desc: 'Multi-tenant email template builder with Monaco, Inky/SCSS compile, live preview and an AI assistant.', href: null },
  { name: 'hire.rest v5', desc: 'This page. No framework, no GSAP, no Lenis — one canvas, one grain engine, ~2k lines.', href: null }
];

export const ABOUT = {
  kicker: 'the whole puzzle',
  title: 'I like the whole puzzle.',
  body: `The interface someone touches. The API behind it. The database that remembers.
         The infrastructure that keeps it running. Building production software since 2020 —
         these days at Prescient Technologies on the Showpad / Bigtincan Content Hub.`,
  kit: [
    { k: 'Interface', v: 'Vanilla JS · Web Components · Lit · React · Next.js · Angular · React Native · TypeScript' },
    { k: 'API', v: 'Node.js · Fastify · Python · FastAPI' },
    { k: 'Data & intelligence', v: 'PostgreSQL · Redis · RAG · LangChain · Pydantic AI · Azure OpenAI · Gemini' },
    { k: 'Infrastructure', v: 'AWS · Azure · GCP · Docker · Kubernetes · CI/CD' }
  ],
  hand: 'ideas are messy. the code doesn\'t have to be.',
  shape: 'puzzle'
};

export const JOURNEY = [
  { when: '2025 → now', org: 'Prescient Technologies', role: 'Senior System Developer · Showpad / Bigtincan', body: 'Content Hub features, JavaScript-to-TypeScript migration, code reviews and production performance.' },
  { when: '2024 → 2025', org: 'Ergobite Tech Solutions', role: 'Software Developer · Intellify', body: 'Multi-agent knowledge systems, RAG search, data migration and cloud automation on Azure.' },
  { when: '2024', org: 'Internship Studio', role: 'Senior Web Developer', body: 'AI-powered hiring, a cross-platform mobile app and full-stack exam platforms.' },
  { when: '2022 → 2024', org: 'Infosys', role: 'System Engineer · Infosys Cortex', body: 'Enterprise web apps, Salesforce integration, WebRTC and accessible user experiences.' },
  { when: '2020 → 2022', org: 'Internship Studio', role: 'Web Developer', body: 'Web platforms, payment integrations and the foundations of building end to end.' }
];

export const EDU = 'MCA · Vishwakarma Institute of Technology, Pune · 2022 · CGPA 8.75';

export const CONTACT = {
  kicker: 'hello',
  hand: 'every good thing starts with a conversation',
  title: ['Got a "what if?"', 'Let\'s build it.'],
  cta: 'Say hello',
  shape: 'hello'
};

export const NAV = [
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
  { id: 'journey', label: 'Journey' },
  { id: 'contact', label: 'Contact', hot: true }
];

/* ---------------------------------------------------------------------------
   ART — one source of truth for every drawing.
   Each shape is a list of SVG path strings in a 0 0 200 200 box.
   • field.js strokes them into an offscreen canvas and samples the pixels,
     so 4,000 particles fly into the drawing.
   • app.js injects the very same paths as the faint "blueprint" line art that
     stays visible behind the particles (and for anyone with JS off).
   Text shapes ({ text }) are rasterised in the hand font instead.
   ------------------------------------------------------------------------ */
export const ART = {
  spark: {
    paths: [
      'M100 34 L100 166', 'M34 100 L166 100',
      'M53 53 L147 147', 'M147 53 L53 147',
      'M100 12 A88 88 0 0 1 188 100', 'M188 100 A88 88 0 0 1 100 188',
      'M100 188 A88 88 0 0 1 12 100', 'M12 100 A88 88 0 0 1 100 12',
      'M100 78 A22 22 0 1 1 99.9 78'
    ]
  },
  bill: {
    paths: [
      'M52 22 H148 V166 L136 176 L124 166 L112 176 L100 166 L88 176 L76 166 L64 176 L52 166 Z',
      'M70 56 H130', 'M70 78 H130', 'M70 100 H112',
      'M70 132 H130', 'M92 122 H108',
      'M118 118 a10 10 0 1 1 0 0.1 M128 112 v26 M120 130 l16 0'
    ]
  },
  wave: {
    paths: [
      'M100 30 a20 20 0 0 1 20 20 v26 a20 20 0 0 1 -40 0 v-26 a20 20 0 0 1 20 -20 z',
      'M64 82 a36 36 0 0 0 72 0', 'M100 118 v22', 'M76 146 h48',
      'M28 96 v10', 'M40 78 v46', 'M172 96 v10', 'M160 78 v46',
      'M16 100 v4'
    ]
  },
  cue: {
    paths: [
      'M26 40 a10 10 0 0 1 10 -10 h128 a10 10 0 0 1 10 10 v84 a10 10 0 0 1 -10 10 h-128 a10 10 0 0 1 -10 -10 z',
      'M86 62 L124 84 L86 106 Z',
      'M100 134 v22', 'M70 162 h60',
      'M44 52 a6 6 0 1 1 -0.1 0', 'M156 52 a6 6 0 1 1 -0.1 0'
    ]
  },
  chat: {
    paths: [
      'M30 46 a12 12 0 0 1 12 -12 h76 a12 12 0 0 1 12 12 v44 a12 12 0 0 1 -12 12 h-46 l-24 22 v-22 h-6 a12 12 0 0 1 -12 -12 z',
      'M88 118 h62 a12 12 0 0 1 12 12 v34 a12 12 0 0 1 -12 12 h-8 l-20 20 v-20 h-34 a12 12 0 0 1 -12 -12 v-22',
      'M54 62 h52', 'M54 82 h34',
      'M148 40 l26 44 -12 -2 -6 14 z'
    ]
  },
  grid: {
    paths: [
      'M28 40 h144 v120 h-144 z', 'M28 74 h144', 'M28 106 h144', 'M28 138 h144',
      'M84 40 v120', 'M132 40 v120',
      'M44 57 h22', 'M100 57 h16', 'M146 57 h12',
      'M44 90 h26', 'M100 90 h14',
      'M136 122 l10 10 l20 -22'
    ]
  },
  puzzle: {
    paths: [
      'M40 62 h34 a16 16 0 1 1 26 0 h34 v34 a16 16 0 1 0 0 26 v34 h-94 v-34 a16 16 0 1 1 0 -26 z',
      'M148 96 h18 v60 h-30',
      'M58 172 v-14', 'M100 46 v-14',
      'M170 40 l6 12 l12 6 l-12 6 l-6 12 l-6 -12 l-12 -6 l12 -6 z'
    ]
  },
  route: {
    paths: [
      'M28 168 C60 168 56 112 92 112 S124 56 168 56',
      'M28 168 a12 12 0 1 1 -0.1 0', 'M92 112 a10 10 0 1 1 -0.1 0', 'M168 56 a12 12 0 1 1 -0.1 0',
      'M52 140 h20', 'M112 84 h20', 'M150 30 h22', 'M150 82 h22'
    ]
  }
};

export const TEXT_ART = {
  hello: { text: 'hello', font: '700 150px Caveat, "Segoe Print", cursive', box: [360, 170] }
};
