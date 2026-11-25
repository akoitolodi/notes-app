/**
 * subjectCatalog — Subject Learning Studio engine ("Learn Subjects").
 * Ships with MS 102: Quantitative Methods (plus IT starter tracks) and dynamically fetches
 * open-source educational content from Wikipedia, Wikibooks & OpenAlex for ANY topic.
 */
import { db } from '../store/db';
import { searchOpenAlex } from './research';

const CUSTOM_SUBJECTS_KEY = 'aicn:customSubjects:v1';
const SUBJECT_PROGRESS_KEY = 'aicn:subjectProgress:v1';

export const BUILTIN_SUBJECTS = [
  {
    id: 'ms102-quant',
    code: 'MS 102',
    name: 'Quantitative Methods',
    category: 'Business & Math',
    badge: 'Featured · Lab',
    description:
      'Decision Theory (EMV, Maximax/Maximin), Linear Programming, PERT/CPM Critical Path, Inventory EOQ, Probability & Queueing.',
    topics: [
      {
        slug: 'decision-theory',
        title: 'Decision Theory & Payoff Matrices',
        wikiQuery: 'Decision theory',
        wikibookQuery: 'Operations Research Decision Analysis',
        labId: 'decision',
        formulaSummary:
          '• Maximax: Pick best possible payoff (Optimistic)\n' +
          '• Maximin: Pick best of worst payoffs (Conservative)\n' +
          '• Minimax Regret: Minimize max opportunity loss per state\n' +
          '• EMV = Σ (Payoff × Probability)\n' +
          '• EVPI = Expected Value with Perfect Info − Best EMV',
      },
      {
        slug: 'linear-programming',
        title: 'Linear Programming (Corner-Point Method)',
        wikiQuery: 'Linear programming',
        wikibookQuery: 'Operations Research Linear Programming',
        labId: 'lp',
        formulaSummary:
          '• Objective: Maximize or Minimize Z = c₁x + c₂y\n' +
          '• Constraints: a₁x + a₂y ≤ or ≥ b, plus x ≥ 0, y ≥ 0\n' +
          '• Fundamental Theorem: Optimal Z always occurs at a feasible corner vertex!',
      },
      {
        slug: 'pert-cpm',
        title: 'PERT / CPM Project Scheduling',
        wikiQuery: 'Critical path method',
        wikibookQuery: 'Project Management Critical Path',
        labId: 'pert',
        formulaSummary:
          '• Expected Time: te = (O + 4M + P) / 6\n' +
          '• Activity Variance: σ² = ((P − O) / 6)²\n' +
          '• Forward Pass: ES = max(Pred EF), EF = ES + duration\n' +
          '• Backward Pass: LF = min(Succ LS), LS = LF − duration\n' +
          '• Slack = LS − ES (Critical Path activities have Slack = 0)',
      },
      {
        slug: 'inventory-eoq',
        title: 'Inventory Control & EOQ Model',
        wikiQuery: 'Economic order quantity',
        wikibookQuery: 'Supply Chain Management Economic Order Quantity',
        labId: 'eoq',
        formulaSummary:
          '• EOQ (Q*) = √(2DS / H)\n' +
          '• Orders per Year = D / Q*\n' +
          '• Total Annual Cost = (D/Q)S + (Q/2)H\n' +
          '• Reorder Point (ROP) = Daily Demand × Lead Time (days)',
      },
      {
        slug: 'bayes-probability',
        title: 'Expected Value & Bayes Theorem',
        wikiQuery: 'Bayes theorem',
        wikibookQuery: 'Probability Bayes Theorem',
        labId: 'decision',
        formulaSummary:
          '• P(A|B) = [P(B|A) × P(A)] / P(B)\n' +
          '• Expected Value E(X) = Σ x · P(x)\n' +
          '• Variance = Σ (x − μ)² · P(x)',
      },
      {
        slug: 'forecasting-queueing',
        title: 'Forecasting & M/M/1 Queueing Basics',
        wikiQuery: 'Queueing theory',
        wikibookQuery: 'Operations Research Queueing',
        labId: 'eoq',
        formulaSummary:
          '• Simple Moving Average: Ft = (Dt-1 + Dt-2 + ... + Dt-n) / n\n' +
          '• Exponential Smoothing: Ft+1 = α·Dt + (1 − α)·Ft\n' +
          '• M/M/1 Utilization ρ = λ / μ (requires λ < μ)\n' +
          '• Avg in System L = λ / (μ − λ), Avg Wait Wq = λ / [μ(μ − λ)]',
      },
    ],
  },
  {
    id: 'net-fundamentals',
    code: 'NET 101',
    name: 'Networking & Cabling',
    category: 'IT & Systems',
    badge: 'Open Docs',
    description: 'OSI/TCP-IP layers, Ethernet T568A/B standards, IPv4 subnetting & stateful firewalls.',
    topics: [
      {
        slug: 'ethernet-cabling',
        title: 'TIA/EIA-568 Ethernet Cabling',
        wikiQuery: 'TIA/EIA-568',
        wikibookQuery: 'Computer Networks Ethernet',
        formulaSummary:
          '• T568B: W/O, O, W/G, B, W/B, G, W/Br, Br\n' +
          '• T568A: W/G, G, W/O, B, W/B, O, W/Br, Br\n' +
          '• Crossover swaps Pins 1↔3 and 2↔6.',
      },
      {
        slug: 'ipv4-subnetting',
        title: 'IPv4 CIDR & Subnetting',
        wikiQuery: 'Subnet',
        wikibookQuery: 'Computer Networks Subnetting',
        formulaSummary:
          '• Usable Hosts = 2^(32 − prefix) − 2\n' +
          '• Network Address = IP AND Subnet Mask',
      },
    ],
  },
  {
    id: 'discrete-logic',
    code: 'IT 105',
    name: 'Discrete Structures & Logic',
    category: 'Business & Math',
    badge: 'Logic Ready',
    description: 'Propositional truth tables, conditionals (IF/THEN/IFF), De Morgan laws & sets.',
    topics: [
      {
        slug: 'propositional-logic',
        title: 'Propositional Logic & Conditionals',
        wikiQuery: 'Propositional calculus',
        wikibookQuery: 'Discrete Mathematics Logic',
        formulaSummary:
          '• P → Q is False ONLY when P is True and Q is False.\n' +
          '• P ↔ Q (IFF) is True when P and Q have the same truth value.\n' +
          '• De Morgan: ¬(P ∧ Q) ≡ ¬P ∨ ¬Q',
      },
    ],
  },
];

export function getCustomSubjects() {
  try {
    const raw = localStorage.getItem(CUSTOM_SUBJECTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getAllSubjects() {
  return [...BUILTIN_SUBJECTS, ...getCustomSubjects()];
}

export function addCustomSubject({ code = '', name, topics = [] }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Enter a subject name (e.g. Information Assurance).');
  const cleanCode = String(code || '').trim() || cleanName.slice(0, 8).toUpperCase();
  const topicList = (Array.isArray(topics) ? topics : String(topics || '').split(','))
    .map(t => String(t || '').trim())
    .filter(Boolean);
  const finalTopics = (topicList.length > 0 ? topicList : [cleanName]).map((t, idx) => ({
    slug: `${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${idx + 1}`,
    title: t,
    wikiQuery: `${cleanName} ${t}`.trim(),
    wikibookQuery: t,
    formulaSummary: `Open-source syllabus track generated dynamically for ${cleanName}: ${t}.`,
  }));

  const newSubj = {
    id: `custom-${Date.now().toString(36)}`,
    code: cleanCode,
    name: cleanName,
    category: 'Custom Track',
    badge: 'Dynamic Web',
    custom: true,
    description: `Student-added subject track (${finalTopics.length} topic${finalTopics.length === 1 ? '' : 's'}).`,
    topics: finalTopics,
  };

  const existing = getCustomSubjects();
  try {
    localStorage.setItem(CUSTOM_SUBJECTS_KEY, JSON.stringify([...existing, newSubj]));
  } catch {
    // ignore storage errors
  }
  return newSubj;
}

export function removeCustomSubject(id) {
  const next = getCustomSubjects().filter(s => s.id !== id);
  try {
    localStorage.setItem(CUSTOM_SUBJECTS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function getSubjectProgress() {
  try {
    const raw = localStorage.getItem(SUBJECT_PROGRESS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export function markSubjectTopicDone(subjectId, topicSlug) {
  const prog = getSubjectProgress();
  const list = new Set(Array.isArray(prog[subjectId]) ? prog[subjectId] : []);
  list.add(topicSlug);
  const next = { ...prog, [subjectId]: [...list] };
  try {
    localStorage.setItem(SUBJECT_PROGRESS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

async function fetchWikiTopicExtract(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    const sr = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&utf8=1&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(q)}`
    );
    if (!sr.ok) return null;
    const sJson = await sr.json();
    const top = sJson?.query?.search?.[0];
    if (!top?.title) return null;
    const title = top.title;
    const ex = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=4200&format=json&origin=*&titles=${encodeURIComponent(title)}`
    );
    if (!ex.ok) return null;
    const exJson = await ex.json();
    const pages = exJson?.query?.pages || {};
    const firstPage = Object.values(pages)[0];
    const extract = String(firstPage?.extract || '').trim();
    if (!extract) return null;
    return {
      source: 'Wikipedia (CC BY-SA)',
      title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      content: extract,
    };
  } catch {
    return null;
  }
}

async function fetchWikibookExcerpt(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    const sr = await fetch(
      `https://en.wikibooks.org/w/api.php?action=query&list=search&utf8=1&format=json&origin=*&srlimit=2&srsearch=${encodeURIComponent(q)}`
    );
    if (!sr.ok) return null;
    const data = await sr.json();
    const hit = data?.query?.search?.[0];
    if (!hit?.title) return null;
    const ex = await fetch(
      `https://en.wikibooks.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=2400&format=json&origin=*&titles=${encodeURIComponent(hit.title)}`
    );
    const exJson = ex.ok ? await ex.json() : null;
    const first = Object.values(exJson?.query?.pages || {})[0];
    const text = String(first?.extract || hit.snippet || '')
      .replace(/<[^>]+>/g, '')
      .trim();
    return {
      source: 'Wikibooks (Open Textbook)',
      title: hit.title,
      url: `https://en.wikibooks.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      content: text,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch open-source textbook/reference material dynamically for a subject topic and cache in IndexedDB.
 */
export async function fetchOpenSourceModule(subject, topic, { forceRefresh = false } = {}) {
  const cacheKey = `subject:${subject.id}:${topic.slug}`;
  if (!forceRefresh) {
    try {
      const cached = await db.codingCache.get(cacheKey);
      if (cached?.data) {
        return { ...cached.data, fromCache: true };
      }
    } catch {
      // ignore cache miss
    }
  }

  const [wiki, book, papers] = await Promise.all([
    fetchWikiTopicExtract(topic.wikiQuery || `${subject.name} ${topic.title}`),
    fetchWikibookExcerpt(topic.wikibookQuery || topic.title),
    searchOpenAlex(`${topic.title} ${subject.name}`, 2).catch(() => []),
  ]);

  const sections = [];
  if (topic.formulaSummary) {
    sections.push({
      heading: 'Key Formulas & Rules',
      source: 'Offline Quick Reference',
      body: topic.formulaSummary,
      url: '',
    });
  }
  if (wiki) {
    sections.push({
      heading: wiki.title,
      source: wiki.source,
      body: wiki.content,
      url: wiki.url,
    });
  }
  if (book && book.content) {
    sections.push({
      heading: `Textbook Excerpt: ${book.title}`,
      source: book.source,
      body: book.content,
      url: book.url,
    });
  }
  if (Array.isArray(papers) && papers.length > 0) {
    sections.push({
      heading: 'Open-Access Research References',
      source: 'OpenAlex',
      body: papers.map((p, idx) => `${idx + 1}. ${p.title}\n   ${p.content}`).join('\n\n'),
      url: papers[0]?.url || '',
    });
  }

  const payload = {
    subjectId: subject.id,
    topicSlug: topic.slug,
    title: topic.title,
    fetchedAt: Date.now(),
    sections,
    onlineFetched: Boolean(wiki || book || (papers && papers.length > 0)),
  };

  if (payload.onlineFetched) {
    try {
      await db.codingCache.put({ key: cacheKey, updatedAt: Date.now(), data: payload });
    } catch {
      // ignore cache write fail
    }
  }

  return { ...payload, fromCache: false };
}
