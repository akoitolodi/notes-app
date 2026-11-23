/**
 * Multi-step Scholarly & Web Research Engine — works with ZERO extra API keys!
 *
 * Sources:
 * - Wikipedia REST / Action API (CORS-friendly, no key needed)
 * - OpenAlex Academic Papers API (peer-reviewed abstracts + citation counts, no key needed)
 * - Tavily Web Search (automatically layered on if the user added a free Tavily key)
 *
 * Free-tier budget: at most 1 compact query-planning LLM call (with local keyword fallback
 * if rate-limited), followed by parallel zero-cost API fetches.
 */
import { aiText, webSearch, createAbortController } from './aiCore';
import { getTavilyKey } from './aiConfig';
import { buildFallbackSearchQuery } from './localRag';
import { parseJsonObject } from '../../shared/aiParsers.js';

/** Reconstruct plain text abstract from OpenAlex inverted index format. */
export function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (Number.isInteger(pos) && pos >= 0 && pos < 600) {
        words[pos] = word;
      }
    }
  }
  return words.filter(Boolean).join(' ').trim();
}

/** Search Wikipedia (origin=* enables CORS in browsers & Capacitor). */
export async function searchWikipedia(query, limit = 2, signal = null) {
  const q = String(query || '').trim();
  if (!q) return [];
  const ctrl = createAbortController(10000, signal);
  try {
    const searchUrl =
      'https://en.wikipedia.org/w/api.php?action=query&list=search&utf8=1&format=json&origin=*' +
      `&srlimit=${limit}&srsearch=${encodeURIComponent(q)}`;
    const res = await fetch(searchUrl, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const hits = data?.query?.search || [];

    const results = await Promise.all(
      hits.slice(0, limit).map(async hit => {
        const title = hit.title || '';
        const cleanSnippet = String(hit.snippet || '').replace(/<[^>]+>/g, '');
        const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        try {
          const sumRes = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
            { signal: ctrl.signal }
          );
          if (sumRes.ok) {
            const sum = await sumRes.json();
            return {
              title: sum.title || title,
              url: sum.content_urls?.desktop?.page || pageUrl,
              content: (sum.extract || cleanSnippet).slice(0, 650),
              kind: 'wiki',
            };
          }
        } catch {
          // fallback to search snippet
        }
        return {
          title,
          url: pageUrl,
          content: cleanSnippet.slice(0, 500),
          kind: 'wiki',
        };
      })
    );

    return results.filter(r => r && r.content);
  } catch {
    return [];
  } finally {
    ctrl.cleanup();
  }
}

/** Search OpenAlex peer-reviewed academic papers (100% free, no API key, CORS-enabled). */
export async function searchOpenAlex(query, limit = 3, signal = null) {
  const q = String(query || '').trim();
  if (!q) return [];
  const ctrl = createAbortController(10000, signal);
  try {
    const url =
      'https://api.openalex.org/works' +
      `?search=${encodeURIComponent(q)}` +
      `&per-page=${limit}` +
      '&sort=relevance_score:desc' +
      '&select=id,display_name,publication_year,doi,primary_location,abstract_inverted_index,cited_by_count';
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const works = data?.results || [];

    return works
      .map(w => {
        const abstract = reconstructAbstract(w.abstract_inverted_index);
        const landing =
          w.primary_location?.landing_page_url ||
          (w.doi ? w.doi : '') ||
          w.id ||
          '';
        const title = w.display_name || '';
        if (!title) return null;
        const meta = [
          w.publication_year ? `(${w.publication_year})` : '',
          Number.isFinite(w.cited_by_count) ? `${w.cited_by_count} citations` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return {
          title,
          url: landing,
          content: abstract
            ? `${meta ? meta + ' — ' : ''}${abstract.slice(0, 580)}`
            : `${title}${meta ? ' ' + meta : ''}`,
          kind: 'paper',
          year: w.publication_year || null,
          citations: Number.isFinite(w.cited_by_count) ? w.cited_by_count : null,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    ctrl.cleanup();
  }
}

/**
 * Plan 2-3 targeted search queries from a student's question + note context.
 * Automatically falls back to local keyword extraction if the LLM hits a rate limit.
 */
export async function planResearchQueries({
  question,
  noteTitle = '',
  subject = '',
  noteExcerpt = '',
  signal = null,
}) {
  const fallback = buildFallbackSearchQuery(question, noteTitle, subject);
  try {
    const raw = await aiText({
      system:
        'You are a research query planner. Turn the student question + note topic into 2 or 3 crisp, specific search queries (3-7 words each) suitable for Wikipedia and academic search. Output ONLY valid JSON: {"queries": ["query 1", "query 2"]}.',
      user: `Subject: ${subject || 'General'}\nNote title: ${noteTitle || 'Untitled'}\nNote excerpt: ${String(noteExcerpt || '').slice(0, 600)}\nStudent question: ${question}`,
      maxTokens: 220,
      timeoutMs: 30000,
      signal,
    });
    const parsed = parseJsonObject(raw);
    const list = Array.isArray(parsed?.queries)
      ? parsed.queries
          .map(q => String(q || '').trim())
          .filter(q => q.length >= 3)
          .slice(0, 3)
      : [];
    return list.length > 0 ? list : [fallback];
  } catch (err) {
    if (err?.isCancelled) throw err;
    return [fallback];
  }
}

/**
 * Run bounded multi-source research across Wikipedia, OpenAlex papers, and optional Tavily.
 * Deduplicates by URL and returns indexed sources ready for [1], [2] citations.
 */
export async function runMultiSourceResearch({
  question,
  noteTitle = '',
  subject = '',
  noteExcerpt = '',
  signal = null,
  onStatus = null,
}) {
  onStatus?.('Planning search queries…');
  const queries = await planResearchQueries({
    question,
    noteTitle,
    subject,
    noteExcerpt,
    signal,
  });

  const primaryQuery = queries[0] || buildFallbackSearchQuery(question, noteTitle, subject);
  const secondaryQuery = queries[1] || primaryQuery;
  const tavilyKey = getTavilyKey();

  onStatus?.(
    tavilyKey
      ? 'Searching Wikipedia, academic papers & web…'
      : 'Searching Wikipedia & academic papers…'
  );

  const tasks = [
    searchWikipedia(primaryQuery, 2, signal),
    searchOpenAlex(secondaryQuery, 3, signal),
  ];
  if (queries[2]) {
    tasks.push(searchWikipedia(queries[2], 1, signal));
  }
  if (tavilyKey) {
    tasks.push(
      webSearch(primaryQuery, tavilyKey, 3, signal).catch(() => [])
    );
  }

  const batches = await Promise.all(tasks);
  const rawResults = batches.flat();

  // Deduplicate by normalized URL / title and cap at 6 diverse sources
  const seen = new Set();
  const sources = [];
  for (const r of rawResults) {
    if (!r || !r.title) continue;
    const key = (r.url || r.title).toLowerCase().replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      index: sources.length + 1,
      title: r.title,
      url: r.url || '',
      content: String(r.content || '').slice(0, 620),
      kind: r.kind || 'web',
      year: r.year || null,
      citations: r.citations ?? null,
    });
    if (sources.length >= 6) break;
  }

  return { queries, sources };
}
