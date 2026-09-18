/* ============================================================================
   content.js — every word, link and drawing on the page lives here.

   The facts about Jayesh are NOT retyped here: they come from resume.js, the
   same file make-pdf.js reads to build the PDF. Edit a bullet there and both
   the page and the download change together.

   What lives here is the *page*: the hero copy, the section blurbs, the skills
   grid, and the drawings the particle field inks into.
   ========================================================================== */

import { PERSON, SUMMARY, SKILLS, EXPERIENCE, EDUCATION, CERTIFICATIONS, ACHIEVEMENTS, STATS, FILE_STEM } from './resume.js';
export { PERSON, SUMMARY, SKILLS, EDUCATION, CERTIFICATIONS, ACHIEVEMENTS, STATS };

/* make-pdf.js writes exactly these two files next to index.html. */
const RESUME_PDF = `./${FILE_STEM}.pdf`;
const RESUME_TXT = `./${FILE_STEM}.txt`;

export const ME = {
  name: PERSON.name,
  first: PERSON.first,
  sig: PERSON.sig,
  role: PERSON.role,
  headline: PERSON.headline,
  focus: PERSON.focus,
  place: PERSON.place,
  city: PERSON.city,
  email: PERSON.email,
  phone: PERSON.phone,
  phoneHref: `tel:${PERSON.phoneHref}`,
  availability: PERSON.availability,
  photo: PERSON.photo,
  photoAlt: PERSON.photoAlt,
  /* The download. build.js reads the real byte size off disk for the label. */
  resume: RESUME_PDF,
  resumeTxt: RESUME_TXT,
  resumeName: `${FILE_STEM}.pdf`,
  resumeTxtName: `${FILE_STEM}.txt`,
  socials: [
    { label: 'LinkedIn', href: PERSON.linkedin },
    { label: 'Email', href: `mailto:${PERSON.email}` },
    { label: 'Phone', href: `tel:${PERSON.phoneHref}` },
    { label: 'Résumé', href: RESUME_PDF, download: true }
  ]
};

export const HERO = {
  kicker: ['portfolio', 'D365 · Azure · Power Platform'],
  title: [
    { t: 'I ' },
    { t: 'make ' },
    { t: 'Dynamics ' },
    { t: '365 ' },
    { t: 'do ' },
    { t: 'things ', chaos: true },
    { t: 'it ' },
    { t: 'doesn\u2019t.' }
  ],
  lede: `<strong>${PERSON.headline}.</strong> ${PERSON.years} of CRM implementations, Azure
         Functions and Power Platform automation — the kind of work that quietly
         removes a week of somebody's manual data entry.`,
  ctas: [
    { label: 'Download résumé', href: RESUME_PDF, kind: 'solid', ico: '\u2193', download: true, act: 'resume' },
    { label: 'See the work', href: '#work', kind: 'ghost', ico: '\u2192' }
  ],
  hint: 'run your finger through the ink \u21dd',
  shape: 'spark',
  shapeText: 'what if?'
};

export const TICKER = [
  'Dynamics 365', 'Azure Functions', 'Power Automate', 'C#', 'Project Operations',
  'SAP integration', 'Power BI', 'Ribbon Workbench', 'CI/CD', 'SAFe 6'
];

/* The résumé's achievements, rephrased as numbers a recruiter can scan. */
export const HIGHLIGHTS = STATS;

/* Experience, shaped for the page: resume.js holds the bullets, this adds the
   art each scene inkes into and the one-line framing. */
export const ROLES = EXPERIENCE.map(r => ({
  id: r.id,
  name: r.company,
  short: r.short,
  role: r.role,
  when: r.when,
  place: r.place,
  current: r.current,
  kicker: r.kicker,
  sub: r.sub,
  desc: null,
  bullets: r.bullets,
  tags: r.tags,
  art: r.art,
  note: r.note,
  href: null,
  hrefLabel: null
}));

/* The "kit" grid on the page — same groups as the PDF, wide rather than tall. */
export const KIT = SKILLS.map(g => ({ k: g.group, v: g.items.join(' · ') }));

export const ABOUT = {
  kicker: 'how I work',
  title: 'Enterprise software,\nwithout the enterprise drag.',
  body: `I sit between the business and the system. Requirements come in as a
         conversation in a meeting room; they go out as plugins, Azure Functions,
         Power Automate flows and Power BI dashboards that people actually open
         every morning. Most of my work is Microsoft's stack — Dynamics 365,
         Azure, the Power Platform — and most of the value is in the seams
         between systems that were never designed to talk.`,
  kit: KIT,
  hand: 'the integration is the product.',
  shape: 'puzzle'
};

/* Education and certifications, as a timeline. */
/* Newest first. The certification bodies and the degree are already on the
   line above, so the body copy adds context rather than repeating a name. */
export const JOURNEY = [
  ...CERTIFICATIONS.map(c => ({
    when: 'Certified',
    org: c.name,
    role: c.org,
    body: c.name.includes('SAFe')
      ? 'The delivery model behind the D365 Project Operations rollout — programme-level planning, not just sprints.'
      : 'Building production applications in .NET Core and C#: dependency injection, testing, and the patterns that survive contact with real users.'
  })),
  ...EDUCATION.map(e => ({
    when: e.when,
    org: e.school,
    role: e.degree,
    body: `${e.place}. Computer science fundamentals, systems design, and the software engineering habits the job actually needs.`
  }))
];

export const ACHIEVED = ACHIEVEMENTS;

/* ------------------------------------------------------------- the résumé -- */

export const RESUME = {
  kicker: 'the one-page version',
  title: 'Take it with you.',
  hand: 'print it, forward it, paste it into a portal',
  body: `One page, A4, no fluff — the same content you just scrolled past, laid out
         as a document. Real text (not an image), so applicant tracking systems
         read every field, and the phone, email and LinkedIn in the header are
         clickable.`,
  notes: [
    'One page, A4 — prints cleanly in black and white',
    'Selectable, searchable text — no screenshots',
    'Clickable phone, email and LinkedIn links',
    'A plain-text twin for ATS portals that mangle PDFs'
  ],
  shape: 'doc'
};

export const CONTACT = {
  kicker: 'hello',
  hand: 'the fastest way to find out if I fit is a conversation',
  title: ['Building something on', 'Dynamics 365?'],
  cta: 'Email me',
  shape: 'hello'
};

/* Every id here must be a section id in the built page — page.test.mjs
   asserts it, because a nav link that scrolls nowhere is the kind of thing
   nobody notices until a recruiter clicks it. */
export const NAV = [
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
  { id: 'resume', label: 'Résumé' },
  { id: 'journey', label: 'Journey', desktop: true },   // 5 chips crowd a 360px phone
  { id: 'contact', label: 'Contact', hot: true }
];

/* --------------------------------------------------------------------------- 
   ART — one source of truth for every drawing.
   Each shape is a list of SVG path strings in a 0 0 200 200 box.
   • field.js strokes them into an offscreen canvas and samples the pixels,
     so thousands of particles fly into the drawing.
   • app.js injects the very same paths as the faint "blueprint" line art that
     stays visible behind the particles (and for anyone with JS off).
   Text shapes ({ text }) are rasterised in the hand font instead.
   ------------------------------------------------------------------------ */

export const ART = {
  /* hero — a compass rose / spark, the "what if" mark */
  spark: {
    paths: [
      'M100 30 L100 170', 'M30 100 L170 100',
      'M51 51 L149 149', 'M149 51 L51 149',
      'M100 8 A92 92 0 0 1 192 100', 'M192 100 A92 92 0 0 1 100 192',
      'M100 192 A92 92 0 0 1 8 100', 'M8 100 A92 92 0 0 1 100 8',
      'M100 76 A24 24 0 1 1 99.9 76'
    ]
  },

  /* Siemens — enterprise project management: a project board */
  grid: {
    paths: [
      'M24 36 h152 v128 h-152 z',
      'M24 66 h152', 'M24 100 h152', 'M24 134 h152',
      'M76 36 v128', 'M124 36 v128',
      'M40 51 h24', 'M92 51 h20', 'M140 51 h20',
      'M40 84 h20', 'M92 84 h26', 'M140 84 h16',
      'M40 118 h26', 'M92 118 h18',
      'M140 118 l9 9 l18 -20'
    ]
  },

  /* UST — CRM talking to SAP: two systems, two directions */
  route: {
    paths: [
      'M20 72 h52 v56 h-52 z',
      'M128 72 h52 v56 h-52 z',
      'M72 88 C92 88 108 112 128 112',
      'M72 112 C92 112 108 88 128 88',
      'M112 84 l10 4 l-8 7',
      'M88 116 l-10 -4 l8 -7',
      'M46 44 v16', 'M154 44 v16', 'M100 28 v12',
      'M34 156 h132'
    ]
  },

  /* AssetCues — full-stack foundations: stacked layers */
  puzzle: {
    paths: [
      'M100 40 L172 74 L100 108 L28 74 Z',
      'M28 104 L100 138 L172 104',
      'M28 134 L100 168 L172 134',
      'M100 108 v30',
      'M56 88 h88'
    ]
  },

  /* résumé — a document with a folded corner and a download arrow */
  doc: {
    paths: [
      'M46 24 h74 l34 34 v116 h-108 z',
      'M120 24 v34 h34',
      'M62 84 h74',
      'M62 104 h74',
      'M62 124 h50',
      'M100 150 v34',
      'M88 172 l12 14 l12 -14'
    ]
  },

  /* certification — a medal with a check */
  badge: {
    paths: [
      'M100 26 a40 40 0 1 1 -0.1 0',
      'M100 56 a22 22 0 1 1 -0.1 0',
      'M86 94 l12 12 l24 -26',
      'M84 102 l-14 66 l30 -18 l30 18 l-14 -66'
    ]
  },

  /* degree — a mortarboard */
  cap: {
    paths: [
      'M100 46 L182 84 L100 122 L18 84 Z',
      'M52 104 v38 a48 20 0 0 0 96 0 v-38',
      'M170 90 v46',
      'M170 140 a7 7 0 1 1 -0.1 0'
    ]
  }
};

/* Text shapes are rasterised in the hand face instead of stroked as paths —
   they live here, never in ART, because ART is what the path iterator walks. */
export const TEXT_ART = {
  hello: { text: 'hello', font: '700 150px Caveat, "Segoe Print", cursive', box: [360, 170] }
};

export { FILE_STEM, RESUME_PDF, RESUME_TXT };
