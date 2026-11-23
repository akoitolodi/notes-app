/**
 * codingCatalog — Online open-source coding curriculum & docs fetcher.
 *
 * Fetches real, free, open-licensed resources live over the internet and caches
 * them locally in Dexie (`codingCache`) so learning takes place inside Notes by Bai:
 * - Lessons: adambard/learnxinyminutes-docs (CC BY-SA 3.0, GitHub Raw)
 * - Challenges: exercism/problem-specifications (MIT, GitHub Raw)
 * - Live Docs: MDN Web Docs Search API + Wikipedia CS Summary API
 */
import { db } from '../store/db';

const PROGRESS_KEY = 'aicn:codingProgress';

export const CODING_LANGUAGES = [
  {
    id: 'python',
    name: 'Python',
    category: 'General',
    badge: 'Popular',
    learnXSlug: 'python',
    codapiSandbox: 'python',
    highlightLang: 'python',
    description: 'Clean syntax for automation, scripting, data science & backend',
    starterCode: `# Welcome to Python in Notes by Bai!\ndef greet(name):\n    return f"Hello, {name}! Ready to code."\n\nfor i in range(1, 4):\n    print(f"{i}. {greet('Bai')}")\n`,
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    category: 'Web',
    badge: 'Offline Run',
    learnXSlug: 'javascript',
    codapiSandbox: 'local-js',
    highlightLang: 'javascript',
    description: 'The language of the web — runs instantly offline in-app',
    starterCode: `// Instant offline JavaScript runner\nconst nums = [3, 1, 4, 1, 5, 9];\nconst doubled = nums.map(n => n * 2);\nconsole.log("Original:", nums.join(", "));\nconsole.log("Doubled:", doubled.join(", "));\nconsole.log("Sum:", nums.reduce((a, b) => a + b, 0));\n`,
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    category: 'Web',
    badge: 'Typed JS',
    learnXSlug: 'typescript',
    codapiSandbox: 'typescript',
    highlightLang: 'typescript',
    description: 'JavaScript with static types for safer large apps',
    starterCode: `interface Student {\n  name: string;\n  scores: number[];\n}\n\nfunction average(s: Student): number {\n  return s.scores.reduce((a, b) => a + b, 0) / s.scores.length;\n}\n\nconst me: Student = { name: "Bai", scores: [92, 95, 98] };\nconsole.log(\`\${me.name} avg: \${average(me).toFixed(1)}\`);\n`,
  },
  {
    id: 'html',
    name: 'HTML & CSS',
    category: 'Web',
    badge: 'Live Preview',
    learnXSlug: 'html',
    codapiSandbox: 'local-html',
    highlightLang: 'html',
    description: 'Structure and style web pages with live visual preview',
    starterCode: `<style>\n  body { font-family: system-ui, sans-serif; padding: 16px; background: #fffbeb; }\n  .card { background: #fff; border: 2px solid #f59e0b; border-radius: 12px; padding: 14px; }\n  h2 { margin: 0 0 6px; color: #b45309; }\n</style>\n<div class="card">\n  <h2>Hello from HTML &amp; CSS!</h2>\n  <p>Edit this code and tap <strong>Run</strong> to see live changes.</p>\n</div>\n`,
  },
  {
    id: 'css',
    name: 'CSS',
    category: 'Web',
    badge: 'Styling',
    learnXSlug: 'css',
    codapiSandbox: 'local-html',
    highlightLang: 'css',
    description: 'Flexbox, Grid, animations & responsive UI styling',
    starterCode: `<style>\n  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-family: system-ui; }\n  .box { background: #2563eb; color: #fff; padding: 16px; border-radius: 10px; text-align: center; font-weight: 700; }\n</style>\n<div class="grid">\n  <div class="box">1</div>\n  <div class="box">2</div>\n  <div class="box">3</div>\n</div>\n`,
  },
  {
    id: 'c',
    name: 'C',
    category: 'Systems',
    badge: 'Systems',
    learnXSlug: 'c',
    codapiSandbox: 'c',
    highlightLang: 'c',
    description: 'Pointers, memory management, OS kernels & embedded systems',
    starterCode: `#include <stdio.h>\n\nint main(void) {\n    int nums[] = {2, 4, 6, 8};\n    int sum = 0;\n    for (int i = 0; i < 4; i++) sum += nums[i];\n    printf("Sum = %d\\n", sum);\n    return 0;\n}\n`,
  },
  {
    id: 'cpp',
    name: 'C++',
    category: 'Systems',
    badge: 'DSA / Games',
    learnXSlug: 'c++',
    codapiSandbox: 'cpp',
    highlightLang: 'cpp',
    description: 'High-performance OOP, STL containers & competitive programming',
    starterCode: `#include <iostream>\n#include <vector>\n#include <algorithm>\n\nint main() {\n    std::vector<int> v = {5, 2, 9, 1, 7};\n    std::sort(v.begin(), v.end());\n    for (int x : v) std::cout << x << " ";\n    std::cout << "\\n";\n    return 0;\n}\n`,
  },
  {
    id: 'java',
    name: 'Java',
    category: 'General',
    badge: 'OOP / Android',
    learnXSlug: 'java',
    codapiSandbox: 'java',
    highlightLang: 'java',
    description: 'Object-oriented programming, enterprise backends & JVM',
    starterCode: `public class Main {\n    public static void main(String[] args) {\n        String[] topics = {"Classes", "Interfaces", "Streams"};\n        for (String t : topics) {\n            System.out.println("Java topic: " + t);\n        }\n    }\n}\n`,
  },
  {
    id: 'csharp',
    name: 'C#',
    category: 'General',
    badge: '.NET / Unity',
    learnXSlug: 'csharp',
    codapiSandbox: 'csharp',
    highlightLang: 'csharp',
    description: '.NET APIs, desktop apps & Unity game development',
    starterCode: `using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello from C#!");\n    }\n}\n`,
  },
  {
    id: 'sql',
    name: 'SQL (SQLite)',
    category: 'Data & Shell',
    badge: 'Databases',
    learnXSlug: 'sql',
    codapiSandbox: 'sqlite',
    highlightLang: 'sql',
    description: 'Relational tables, SELECT, JOIN, GROUP BY & subqueries',
    starterCode: `CREATE TABLE courses (id INTEGER PRIMARY KEY, title TEXT, credits INTEGER);\nINSERT INTO courses VALUES (1, 'Data Structures', 3), (2, 'Databases', 4), (3, 'OS', 3);\nSELECT title, credits FROM courses WHERE credits >= 3 ORDER BY credits DESC;\n`,
  },
  {
    id: 'php',
    name: 'PHP',
    category: 'Web',
    badge: 'Backend',
    learnXSlug: 'php',
    codapiSandbox: 'php',
    highlightLang: 'php',
    description: 'Server-side web apps, Laravel & dynamic sites',
    starterCode: `<?php\n$langs = ["PHP", "SQL", "HTML"];\necho "Stack: " . implode(" + ", $langs) . "\\n";\n`,
  },
  {
    id: 'go',
    name: 'Go',
    category: 'Systems',
    badge: 'Cloud / Fast',
    learnXSlug: 'go',
    codapiSandbox: 'go',
    highlightLang: 'go',
    description: 'Simple, fast compiled language with goroutines & channels',
    starterCode: `package main\nimport "fmt"\n\nfunc main() {\n    for i := 1; i <= 3; i++ {\n        fmt.Printf("Go step %d\\n", i)\n    }\n}\n`,
  },
  {
    id: 'rust',
    name: 'Rust',
    category: 'Systems',
    badge: 'Memory Safe',
    learnXSlug: 'rust',
    codapiSandbox: 'rust',
    highlightLang: 'rust',
    description: 'Ownership, borrowing & fearless systems concurrency',
    starterCode: `fn main() {\n    let nums = vec![10, 20, 30];\n    let total: i32 = nums.iter().sum();\n    println!("Total = {}", total);\n}\n`,
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    category: 'General',
    badge: 'Android',
    learnXSlug: 'kotlin',
    codapiSandbox: 'ai',
    highlightLang: 'kotlin',
    description: 'Modern null-safe JVM language for Android development',
    starterCode: `fun main() {\n    val items = listOf("Null safety", "Coroutines", "Data classes")\n    items.forEach { println("Kotlin: $it") }\n}\n`,
  },
  {
    id: 'swift',
    name: 'Swift',
    category: 'General',
    badge: 'iOS / Apple',
    learnXSlug: 'swift',
    codapiSandbox: 'swift',
    highlightLang: 'swift',
    description: 'Safe, expressive language for iOS and macOS apps',
    starterCode: `let scores = [88, 94, 100]\nlet total = scores.reduce(0, +)\nprint("Total score: \\(total)")\n`,
  },
  {
    id: 'bash',
    name: 'Bash / Linux',
    category: 'Data & Shell',
    badge: 'CLI / DevOps',
    learnXSlug: 'bash',
    codapiSandbox: 'sh',
    highlightLang: 'bash',
    description: 'Shell scripting, pipes, grep, awk & Linux automation',
    starterCode: `#!/usr/bin/env bash\nfor item in Notes Code Practice; do\n  echo "Studying: $item"\ndone\n`,
  },
  {
    id: 'ruby',
    name: 'Ruby',
    category: 'General',
    badge: 'Expressive',
    learnXSlug: 'ruby',
    codapiSandbox: 'ruby',
    highlightLang: 'ruby',
    description: 'Human-friendly OOP scripting & Rails web framework',
    starterCode: `[1, 2, 3, 4].each { |n| puts "#{n} squared is #{n * n}" }\n`,
  },
  {
    id: 'dart',
    name: 'Dart',
    category: 'Web',
    badge: 'Flutter',
    learnXSlug: 'dart',
    codapiSandbox: 'dart',
    highlightLang: 'dart',
    description: 'UI-optimized typed language powering Flutter apps',
    starterCode: `void main() {\n  final topics = ['Widgets', 'Async/Await', 'Sound Null Safety'];\n  for (final t in topics) print('Dart: $t');\n}\n`,
  },
];

export const CODING_CHALLENGES = [
  { slug: 'two-fer', title: 'Two Fer', difficulty: 'Easy', topic: 'Strings & Default Args' },
  { slug: 'reverse-string', title: 'Reverse String', difficulty: 'Easy', topic: 'Strings & Loops' },
  { slug: 'leap', title: 'Leap Year', difficulty: 'Easy', topic: 'Conditionals & Logic' },
  { slug: 'raindrops', title: 'Raindrops (FizzBuzz+)', difficulty: 'Easy', topic: 'Modulo & Strings' },
  { slug: 'hamming', title: 'Hamming Distance', difficulty: 'Easy', topic: 'Iteration & Error Handling' },
  { slug: 'pangram', title: 'Pangram Checker', difficulty: 'Easy', topic: 'Sets & Characters' },
  { slug: 'rna-transcription', title: 'RNA Transcription', difficulty: 'Easy', topic: 'Maps / Dictionaries' },
  { slug: 'binary-search', title: 'Binary Search', difficulty: 'Medium', topic: 'Algorithms & O(log n)' },
  { slug: 'anagram', title: 'Anagram Finder', difficulty: 'Medium', topic: 'Sorting & Frequency Maps' },
  { slug: 'word-count', title: 'Word Count', difficulty: 'Medium', topic: 'Parsing & Hash Maps' },
  { slug: 'matrix', title: 'Matrix Rows & Columns', difficulty: 'Medium', topic: '2D Arrays' },
  { slug: 'luhn', title: 'Luhn Checksum Validator', difficulty: 'Medium', topic: 'Math & Validation' },
  { slug: 'sieve', title: 'Sieve of Eratosthenes', difficulty: 'Medium', topic: 'Primes & Arrays' },
  { slug: 'run-length-encoding', title: 'Run-Length Encoding', difficulty: 'Hard', topic: 'Compression & State' },
  { slug: 'linked-list', title: 'Doubly Linked List', difficulty: 'Hard', topic: 'Data Structures & Pointers' },
];

export function getLanguageMeta(langId) {
  return CODING_LANGUAGES.find(l => l.id === langId) || CODING_LANGUAGES[0];
}

/**
 * Parses a Learn X in Y Minutes Markdown file (with YAML frontmatter) into
 * clean, bite-sized study chapters with prose notes and syntax-highlighted code snippets.
 */
export function parseLearnXMarkdown(rawMd, langMeta = CODING_LANGUAGES[0]) {
  let text = String(rawMd || '').replace(/\r\n/g, '\n');

  // Strip YAML frontmatter (--- ... ---)
  const fmMatch = /^---\n[\s\S]*?\n---\n*/.exec(text);
  if (fmMatch) {
    text = text.slice(fmMatch[0].length);
  }

  const chapters = [];
  const codeBlockRe = /```([a-zA-Z0-9_+#.-]*)\n([\s\S]*?)```/g;
  let introParts = [];
  let codeSegments = [];
  let lastIdx = 0;
  let m;

  while ((m = codeBlockRe.exec(text)) !== null) {
    const before = text.slice(lastIdx, m.index).trim();
    if (before) introParts.push(before);
    codeSegments.push({ lang: m[1] || langMeta.highlightLang, code: m[2] });
    lastIdx = m.index + m[0].length;
  }
  const trailing = text.slice(lastIdx).trim();

  if (introParts.length > 0) {
    const introClean = introParts
      .join('\n\n')
      .replace(/^#+\s*/gm, '')
      .slice(0, 900)
      .trim();
    if (introClean) {
      chapters.push({
        id: 'overview',
        title: `Overview — ${langMeta.name}`,
        summary: introClean,
        code: langMeta.starterCode,
        lang: langMeta.highlightLang,
      });
    }
  }

  // Learn X in Y Minutes often puts the entire tutorial inside 1 big fenced code block
  // with numbered comment headings like "## 1. Primitive Datatypes" or "// 2. Variables"
  const sectionHeaderRe =
    /^\s*(?:#{2,4}|\/\/|\/\*|--|;)\s*(?:=+\s*)?(?:\d+\.\s+)?([A-Z][A-Za-z0-9 &/(),'-]{3,65})(?:\s*=+)?\s*(?:\*\/)?$/;
  const dividerRe = /^\s*(?:#{6,}|(?:#|\/\/|--|;)\s*[-=*_#]{5,})\s*$/;

  for (const seg of codeSegments) {
    const lines = seg.code.split('\n');
    let curTitle = `${langMeta.name} Core Syntax`;
    let curLines = [];

    const flushChapter = () => {
      const codeBody = curLines.join('\n').trim();
      if (!codeBody || codeBody.length < 25) return;
      // Extract top comment lines as quick explanation summary
      const commentLines = [];
      for (const ln of codeBody.split('\n').slice(0, 8)) {
        const cm = /^\s*(?:#|\/\/|--)\s?(.*)$/.exec(ln);
        if (cm && cm[1].trim() && !/^[-=*_#]{4,}$/.test(cm[1].trim())) {
          commentLines.push(cm[1].trim());
        } else if (ln.trim()) {
          break;
        }
      }
      chapters.push({
        id: `ch-${chapters.length}`,
        title: curTitle,
        summary:
          commentLines.slice(0, 3).join(' ') ||
          `Hands-on ${langMeta.name} examples for ${curTitle}.`,
        code: codeBody,
        lang: seg.lang || langMeta.highlightLang,
      });
    };

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (dividerRe.test(ln)) continue;
      const hm = sectionHeaderRe.exec(ln);
      const prevBlank = i === 0 || !lines[i - 1].trim() || dividerRe.test(lines[i - 1]);
      if (hm && prevBlank) {
        if (curLines.length >= 6) {
          flushChapter();
          curLines = [];
        }
        curTitle = hm[1].trim();
        continue;
      }
      curLines.push(ln);
      // Guard against overly huge single chapters (split cleanly at blank line after ~55 lines)
      if (curLines.length >= 60 && !ln.trim()) {
        flushChapter();
        curTitle = `${curTitle.replace(/\s*\(Part \d+\)$/, '')} (Part ${chapters.length + 1})`;
        curLines = [];
      }
    }
    flushChapter();
  }

  if (trailing && chapters.length > 0) {
    chapters.push({
      id: 'further-reading',
      title: 'Further Reading & Resources',
      summary: trailing.slice(0, 1200),
      code: '',
      lang: langMeta.highlightLang,
    });
  }

  return chapters.slice(0, 22);
}

/**
 * Fetch open-source language lessons live from adambard/learnxinyminutes-docs
 * and cache locally in Dexie (`codingCache`) for fast revisits.
 */
export async function fetchLanguageLessons(langId, { forceRefresh = false } = {}) {
  const lang = getLanguageMeta(langId);
  const cacheKey = `lessons:${lang.id}`;

  if (!forceRefresh) {
    try {
      const cached = await db.codingCache.get(cacheKey);
      if (cached && Array.isArray(cached.chapters) && cached.chapters.length > 0) {
        return cached;
      }
    } catch {
      // fallback to live fetch
    }
  }

  const candidateUrls = [
    `https://raw.githubusercontent.com/adambard/learnxinyminutes-docs/master/${encodeURIComponent(lang.learnXSlug)}.md`,
    `https://raw.githubusercontent.com/adambard/learnxinyminutes-docs/master/${encodeURIComponent(lang.id)}.md`,
  ];

  let rawMd = '';
  let sourceUrl = candidateUrls[0];
  let lastStatus = 0;

  for (const url of candidateUrls) {
    const res = await fetch(url);
    if (res.ok) {
      rawMd = await res.text();
      sourceUrl = url;
      break;
    }
    lastStatus = res.status;
  }

  if (!rawMd) {
    throw new Error(`Could not fetch ${lang.name} online curriculum (HTTP ${lastStatus || 'network'})`);
  }

  const chapters = parseLearnXMarkdown(rawMd, lang);
  const record = {
    key: cacheKey,
    langId: lang.id,
    sourceUrl,
    sourceLabel: 'Learn X in Y Minutes (CC BY-SA)',
    chapters,
    updatedAt: Date.now(),
  };

  try {
    await db.codingCache.put(record);
  } catch {
    // non-fatal
  }
  return record;
}

/**
 * Fetch an open-source coding exercise prompt live from Exercism Problem Specifications (MIT).
 */
export async function fetchExercismChallenge(slug, { forceRefresh = false } = {}) {
  const meta = CODING_CHALLENGES.find(c => c.slug === slug) || {
    slug,
    title: slug,
    difficulty: 'Medium',
    topic: 'Algorithms',
  };
  const cacheKey = `challenge:${slug}`;

  if (!forceRefresh) {
    try {
      const cached = await db.codingCache.get(cacheKey);
      if (cached?.description) return cached;
    } catch {
      // ignore
    }
  }

  const base = `https://raw.githubusercontent.com/exercism/problem-specifications/main/exercises/${encodeURIComponent(slug)}`;
  const [introRes, instrRes] = await Promise.all([
    fetch(`${base}/introduction.md`).catch(() => null),
    fetch(`${base}/instructions.md`).catch(() => null),
  ]);

  let parts = [];
  if (introRes && introRes.ok) {
    const t = (await introRes.text()).trim();
    if (t) parts.push(t);
  }
  if (instrRes && instrRes.ok) {
    const t = (await instrRes.text()).trim();
    if (t) parts.push(t);
  }

  // Fallback to legacy description.md if neither existed
  if (parts.length === 0) {
    const legacyRes = await fetch(`${base}/description.md`).catch(() => null);
    if (legacyRes && legacyRes.ok) {
      const t = (await legacyRes.text()).trim();
      if (t) parts.push(t);
    } else {
      throw new Error(`Could not fetch "${meta.title}" challenge (HTTP ${instrRes?.status || 'network'})`);
    }
  }

  const description = parts.join('\n\n');
  const record = {
    key: cacheKey,
    slug,
    title: meta.title,
    difficulty: meta.difficulty,
    topic: meta.topic,
    description,
    sourceUrl: `https://github.com/exercism/problem-specifications/tree/main/exercises/${slug}`,
    updatedAt: Date.now(),
  };

  try {
    await db.codingCache.put(record);
  } catch {
    // ignore
  }
  return record;
}

/**
 * Live online documentation lookup via CORS-enabled Stack Overflow API + Wikipedia CS API.
 */
export async function searchOnlineDocs(query, langName = '') {
  const q = String(query || '').trim();
  if (!q) return [];
  const fullQuery =
    langName && !q.toLowerCase().includes(langName.toLowerCase()) ? `${langName} ${q}` : q;

  const [soRes, wikiRes] = await Promise.allSettled([
    fetch(
      `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&q=${encodeURIComponent(fullQuery)}&accepted=True&pagesize=5&site=stackoverflow`
    ).then(r => (r.ok ? r.json() : null)),
    fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(fullQuery + ' programming')}&srlimit=5&format=json&origin=*`
    ).then(r => (r.ok ? r.json() : null)),
  ]);

  const decodeHtml = s =>
    String(s || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

  const out = [];

  if (soRes.status === 'fulfilled' && Array.isArray(soRes.value?.items)) {
    for (const item of soRes.value.items.slice(0, 5)) {
      out.push({
        source: `Stack Overflow (${item.score} votes)`,
        title: decodeHtml(item.title),
        summary: `Tags: ${(item.tags || []).slice(0, 4).join(', ')} · ${item.answer_count || 0} answers`,
        url: item.link,
      });
    }
  }

  if (wikiRes.status === 'fulfilled' && Array.isArray(wikiRes.value?.query?.search)) {
    for (const hit of wikiRes.value.query.search.slice(0, 5)) {
      out.push({
        source: 'Wikipedia CS',
        title: hit.title,
        summary: decodeHtml(hit.snippet),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      });
    }
  }

  return out;
}

export function getCodingProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function markLessonCompleted(langId, chapterId) {
  const p = getCodingProgress();
  const entry = p[langId] || { lessons: [], solved: [] };
  if (!entry.lessons.includes(chapterId)) entry.lessons.push(chapterId);
  p[langId] = entry;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
  return p;
}

export function markChallengeSolved(langId, slug) {
  const p = getCodingProgress();
  const entry = p[langId] || { lessons: [], solved: [] };
  if (!entry.solved.includes(slug)) entry.solved.push(slug);
  p[langId] = entry;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
  return p;
}
