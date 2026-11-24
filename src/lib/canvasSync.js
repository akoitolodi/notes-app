/**
 * canvasSync — Canvas LMS (by Instructure) integration designed for student accounts
 * even when school admins disable Personal Access Tokens.
 *
 * Transport:
 * - On Android APK: uses built-in CapacitorHttp.get() natively (0 CORS, 0 external proxy!)
 * - On Desktop / Web: uses local same-origin POST /api/canvas-proxy in server.js
 *
 * Supports:
 * 1. Canvas Calendar Feed (.ics) -> Assignments, Quizzes, Exams & Due Dates
 * 2. Canvas Course Announcements RSS/Atom Feed + Quick-Paste Announcement Importer
 * 3. Optional Canvas Access Token (if enabled by the user's school)
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getApiBase } from '../config';
import { db, localDateKey } from '../store/db';
import { fetchWithRetry, getAdaptiveTimeouts } from './netResilience';
import { syncDeadlineNotifications, notifyNewCanvasAnnouncements } from './notifications';

export const CANVAS_ICS_KEY = 'aicn:canvasIcsUrl';
export const CANVAS_RSS_KEY = 'aicn:canvasRssUrls';
export const CANVAS_TOKEN_KEY = 'aicn:canvasToken';
export const CANVAS_HOST_KEY = 'aicn:canvasHost';
export const CANVAS_LAST_SYNC_KEY = 'aicn:canvasLastSync';
export const CANVAS_AUTO_SYNC_KEY = 'aicn:canvasAutoSync';

export function getCanvasSettings() {
  try {
    const autoRaw = localStorage.getItem(CANVAS_AUTO_SYNC_KEY);
    return {
      icsUrl: (localStorage.getItem(CANVAS_ICS_KEY) || '').trim(),
      rssUrls: (localStorage.getItem(CANVAS_RSS_KEY) || '').trim(),
      host: (localStorage.getItem(CANVAS_HOST_KEY) || '').trim().replace(/\/+$/, ''),
      token: (localStorage.getItem(CANVAS_TOKEN_KEY) || '').trim(),
      lastSync: Number(localStorage.getItem(CANVAS_LAST_SYNC_KEY) || 0) || 0,
      autoSync: autoRaw === null ? true : autoRaw !== 'false',
    };
  } catch {
    return { icsUrl: '', rssUrls: '', host: '', token: '', lastSync: 0, autoSync: true };
  }
}

export function saveCanvasSettings(patch) {
  try {
    if (patch.icsUrl !== undefined) localStorage.setItem(CANVAS_ICS_KEY, String(patch.icsUrl || '').trim());
    if (patch.rssUrls !== undefined) localStorage.setItem(CANVAS_RSS_KEY, String(patch.rssUrls || '').trim());
    if (patch.host !== undefined) localStorage.setItem(CANVAS_HOST_KEY, String(patch.host || '').trim());
    if (patch.token !== undefined) localStorage.setItem(CANVAS_TOKEN_KEY, String(patch.token || '').trim());
    if (patch.lastSync !== undefined) localStorage.setItem(CANVAS_LAST_SYNC_KEY, String(patch.lastSync || 0));
    if (patch.autoSync !== undefined) localStorage.setItem(CANVAS_AUTO_SYNC_KEY, patch.autoSync ? 'true' : 'false');
  } catch {
    // non-fatal
  }
}

/** Native CapacitorHttp on Android (bypasses CORS cleanly), local /api/canvas-proxy on Web/PC. */
export async function fetchCanvasText(url, token = '') {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) throw new Error('Enter a Canvas URL first.');
  if (!/^https:\/\//i.test(cleanUrl)) {
    throw new Error('Canvas URL must start with https://');
  }

  const headers = {
    Accept: 'text/calendar, application/rss+xml, application/atom+xml, application/json, text/plain, */*',
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  const { fetchMs } = getAdaptiveTimeouts();

  if (Capacitor.isNativePlatform?.() && CapacitorHttp?.get) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await CapacitorHttp.get({
          url: cleanUrl,
          headers,
          connectTimeout: fetchMs,
          readTimeout: fetchMs,
        });
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`Canvas returned HTTP ${res.status}`);
        }
        return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise(r => setTimeout(r, 1200));
      }
    }
    throw lastErr || new Error('Canvas sync timed out on slow connection');
  }

  const apiBase = getApiBase();
  const res = await fetchWithRetry(
    `${apiBase}/api/canvas-proxy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: cleanUrl, token: token || undefined }),
    },
    { retries: 2, timeoutMs: fetchMs }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Canvas sync failed (HTTP ${res.status})`);
  }
  return String(data?.body || '');
}

function unescapeIcs(str) {
  return String(str || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDate(rawVal) {
  const clean = String(rawVal || '').trim();
  // Format 1: 20261128T155900Z (UTC) or 20261128T235900 (floating)
  const dtMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(clean);
  if (dtMatch) {
    const [, y, mo, d, h, mi, s, z] = dtMatch;
    const dt = z
      ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
      : new Date(+y, +mo - 1, +d, +h, +mi, +s);
    return {
      dateKey: localDateKey(dt),
      timeLabel: dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      timestamp: dt.getTime(),
    };
  }
  // Format 2: All-day YYYYMMDD
  const dayMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(clean);
  if (dayMatch) {
    const [, y, mo, d] = dayMatch;
    const dt = new Date(+y, +mo - 1, +d, 23, 59, 0);
    return {
      dateKey: `${y}-${mo}-${d}`,
      timeLabel: 'All day',
      timestamp: dt.getTime(),
    };
  }
  return null;
}

/**
 * Parse RFC-5545 Canvas .ics calendar feed text into structured assignments/events.
 */
export function parseIcsEvents(icsText) {
  // RFC-5545 line unfolding: CRLF followed by space or tab continues the previous line
  const unfolded = String(icsText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '');

  const lines = unfolded.split('\n');
  const events = [];
  let cur = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur && cur.summary && cur.dateInfo) {
        // Canvas puts "[COURSE CODE]" at the end of SUMMARY, e.g. "Problem Set 3 [PHYS 101]"
        let title = cur.summary;
        let course = 'Canvas';
        const courseMatch = /\s*\[([^\]]+)\]\s*$/.exec(title);
        if (courseMatch) {
          course = courseMatch[1].trim();
          title = title.slice(0, courseMatch.index).trim() || title;
        }
        const isExam = /\b(exam|midterm|final|quiz|long test|practical)\b/i.test(title);
        events.push({
          externalUid: cur.uid || `ics:${cur.dateInfo.dateKey}:${title}`,
          title,
          course,
          type: isExam ? 'exam' : 'assignment',
          source: 'canvas',
          dateKey: cur.dateInfo.dateKey,
          timeLabel: cur.dateInfo.timeLabel,
          dueAt: cur.dateInfo.timestamp,
          description: cur.description || '',
          url: cur.url || '',
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const rawKey = line.slice(0, colon).toUpperCase();
    const baseKey = rawKey.split(';')[0];
    const value = line.slice(colon + 1);

    if (baseKey === 'UID') cur.uid = value.trim();
    else if (baseKey === 'SUMMARY') cur.summary = unescapeIcs(value);
    else if (baseKey === 'DESCRIPTION') cur.description = unescapeIcs(value);
    else if (baseKey === 'URL') cur.url = value.trim();
    else if (baseKey === 'DTSTART' && !cur.dateInfo) cur.dateInfo = parseIcsDate(value);
    else if (baseKey === 'DTEND' && !cur.dateInfo) cur.dateInfo = parseIcsDate(value);
  }

  return events.sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
    })
    .replace(/&amp;/gi, '&');
}

/**
 * Convert escaped HTML inside Canvas Atom `<content type="html">` into clean Markdown
 * preserving line breaks and clickable `[Label](https://...)` links!
 */
function htmlContentToMarkdown(rawHtml) {
  let html = decodeXmlEntities(rawHtml);
  // Preserve safe http(s) anchor links as Markdown links
  html = html.replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const cleanLabel = decodeXmlEntities(label.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    const safeUrl = href.trim();
    return cleanLabel ? `[${cleanLabel}](${safeUrl})` : safeUrl;
  });
  // Convert structural breaks to newlines before stripping remaining tags
  html = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');

  return decodeXmlEntities(html)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Parse Canvas Course Announcements RSS / Atom XML feeds (when enabled). */
export function parseRssAnnouncements(xmlText, fallbackCourse = 'Canvas') {
  const xml = String(xmlText || '');
  const out = [];
  const cleanPlain = s =>
    decodeXmlEntities(s)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // Extract feed-level <title> (before the first <item> or <entry>)
  const headerPart = xml.split(/<(?:item|entry)\b/i)[0] || xml;
  const channelTitleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(headerPart);
  const rawCourse = channelTitleMatch ? cleanPlain(channelTitleMatch[1]) : fallbackCourse;
  const courseName =
    rawCourse
      .replace(/\s+Announcements\s+Feed$/i, '')
      .replace(/\s+Announcements$/i, '')
      .trim()
      .slice(0, 64) || fallbackCourse;

  const itemRe = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = cleanPlain((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(block) || [])[1] || '');
    const rawDesc =
      (/<(?:content|description|summary)[^>]*>([\s\S]*?)<\/(?:content|description|summary)>/i.exec(block) || [])[1] || '';
    const desc = htmlContentToMarkdown(rawDesc);
    const authorMatch =
      /<author[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i.exec(block) ||
      /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(block);
    const author = authorMatch ? cleanPlain(authorMatch[1]) : '';
    const linkMatch =
      /<link[^>]+href=["']([^"']+)["']/i.exec(block) || /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block);
    let url = linkMatch ? cleanPlain(linkMatch[1]) : '';
    if (/^http:\/\/[^/]*instructure\.com\//i.test(url)) {
      url = url.replace(/^http:\/\//i, 'https://');
    }
    const guid = cleanPlain((/<(?:guid|id)[^>]*>([\s\S]*?)<\/(?:guid|id)>/i.exec(block) || [])[1] || '');
    const dateRaw = cleanPlain(
      (/<(?:published|pubDate|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:published|pubDate|updated|dc:date)>/i.exec(block) || [])[1] || ''
    );
    const dt = dateRaw ? new Date(dateRaw) : new Date();
    const validDt = Number.isNaN(dt.getTime()) ? new Date() : dt;

    if (title) {
      const detectedDateKey = detectDateInText(`${title}\n${desc}`);
      out.push({
        externalUid: guid || `rss:${title}:${localDateKey(validDt)}`,
        title,
        course: courseName,
        author,
        type: 'announcement',
        source: 'canvas',
        dateKey: localDateKey(validDt),
        detectedDateKey: detectedDateKey || '',
        timeLabel: validDt.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        dueAt: validDt.getTime(),
        description: desc.slice(0, 2000),
        url,
      });
    }
  }
  return out;
}

const MONTH_MAP = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const WEEKDAY_MAP = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/**
 * Detect a mentioned date (ISO, Month Day, relative "tomorrow"/"next Friday", or MM/DD)
 * inside announcement text or plain class notes. Returns YYYY-MM-DD or null.
 */
export function detectDateInText(rawText, refDate = new Date()) {
  const clean = String(rawText || '').trim();
  if (!clean) return null;

  const base = refDate instanceof Date ? new Date(refDate.getTime()) : new Date();
  base.setHours(12, 0, 0, 0);

  // 1. ISO YYYY-MM-DD
  const isoMatch = /\b(20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/.exec(clean);
  if (isoMatch) return isoMatch[1];

  // 2. Month name + day (e.g. "Nov 28", "December 4, 2026", "Jan 15th")
  const monMatch = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i.exec(clean);
  if (monMatch) {
    const mIdx = MONTH_MAP[monMatch[1].toLowerCase()];
    const day = parseInt(monMatch[2], 10);
    const yr = monMatch[3] ? parseInt(monMatch[3], 10) : base.getFullYear();
    if (mIdx !== undefined && day >= 1 && day <= 31) {
      return localDateKey(new Date(yr, mIdx, day));
    }
  }

  // 3. Explicit numeric date with deadline keyword ("due 12/05", "on 11/29/2026")
  const slashMatch = /\b(?:due|on|by|until|deadline[:\s]*)\s*(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/i.exec(clean);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10);
    const d = parseInt(slashMatch[2], 10);
    const yr = slashMatch[3] ? parseInt(slashMatch[3], 10) : base.getFullYear();
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return localDateKey(new Date(yr, m - 1, d));
    }
  }

  // 4. Relative words ("tomorrow", "bukas", "next Friday", "on Monday")
  if (/\b(?:tomorrow|tmrw|bukas)\b/i.test(clean)) {
    const dt = new Date(base.getTime());
    dt.setDate(dt.getDate() + 1);
    return localDateKey(dt);
  }

  const wdMatch = /\b(?:next|this|on|by|until)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i.exec(clean);
  if (wdMatch) {
    const targetDow = WEEKDAY_MAP[wdMatch[1].toLowerCase()];
    if (targetDow !== undefined) {
      const curDow = base.getDay();
      let delta = (targetDow - curDow + 7) % 7;
      if (delta === 0) delta = 7;
      const dt = new Date(base.getTime());
      dt.setDate(dt.getDate() + delta);
      return localDateKey(dt);
    }
  }

  return null;
}

/**
 * Parse a copy-pasted Canvas announcement and automatically detect any mentioned due date!
 */
export function parsePastedAnnouncement(rawText, course = 'Canvas') {
  const clean = String(rawText || '').trim();
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const title = (lines[0] || 'Canvas Announcement').slice(0, 96);
  const body = lines.slice(1).join('\n') || clean;
  const detectedDateKey = detectDateInText(clean);

  return {
    title,
    course: String(course || 'Canvas').trim() || 'Canvas',
    description: body.slice(0, 2000),
    dateKey: localDateKey(),
    detectedDateKey,
  };
}

/** Build a clean, ready-to-work Note body from a synced Canvas assignment or announcement. */
export function buildCanvasNoteContent(item) {
  const isAnnouncement = item.type === 'announcement';
  const lines = [
    `## ${isAnnouncement ? 'Canvas Announcement' : 'Canvas Assignment Details'}`,
    `- **Course:** ${item.course || 'Canvas'}`,
    `- **${isAnnouncement ? 'Posted' : 'Due'}:** ${item.dateKey}${item.timeLabel ? ` · ${item.timeLabel}` : ''}`,
  ];
  if (item.author) {
    lines.push(`- **Posted by:** ${item.author}`);
  }
  if (item.url) {
    lines.push(`- **Link:** [Open in Canvas](${item.url})`);
  }
  lines.push('', `## ${isAnnouncement ? 'Announcement' : 'Instructions'}`);
  lines.push(item.description ? item.description : '*(No description provided on Canvas)*');
  if (!isAnnouncement) {
    lines.push(
      '',
      '## Action Checklist',
      '- [ ] Review related class notes',
      '- [ ] Draft solution / answers',
      '- [ ] Double-check & submit on Canvas',
      '',
      '## My Work & Notes',
      ''
    );
  }
  return lines.join('\n');
}

/**
 * Sync Canvas .ics feed + optional RSS announcements into Dexie `plannerItems`
 * cleanly deduplicated by externalUid (preserving user check-off `done` state!).
 */
export async function syncCanvasFeeds({ icsUrl = '', rssUrls = '', host = '', token = '' } = {}) {
  let added = 0;
  let updated = 0;
  const fetchedItems = [];

  if (icsUrl && icsUrl.trim()) {
    const icsText = await fetchCanvasText(icsUrl.trim());
    fetchedItems.push(...parseIcsEvents(icsText));
  }

  let lastFeedErr = null;
  if (rssUrls && rssUrls.trim()) {
    const urls = rssUrls
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    for (const u of urls) {
      try {
        const xml = await fetchCanvasText(u);
        fetchedItems.push(...parseRssAnnouncements(xml));
      } catch (err) {
        lastFeedErr = err;
      }
    }
    if (fetchedItems.length === 0 && lastFeedErr && !(icsUrl && icsUrl.trim())) {
      throw lastFeedErr;
    }
  }

  // Optional Method A (Access Token) if the user's school enables student tokens
  if (host && token && host.trim() && token.trim()) {
    const base = host.trim().replace(/\/+$/, '');
    const todoRaw = await fetchCanvasText(`${base}/api/v1/users/self/todo`, token.trim());
    const todos = JSON.parse(todoRaw || '[]');
    if (Array.isArray(todos)) {
      for (const td of todos) {
        const a = td.assignment || {};
        const dt = a.due_at ? new Date(a.due_at) : new Date();
        fetchedItems.push({
          externalUid: `canvas-api:assign:${a.id || td.context_name}:${a.due_at || ''}`,
          title: a.name || td.context_name || 'Canvas Task',
          course: td.context_name || 'Canvas',
          type: 'assignment',
          source: 'canvas',
          dateKey: localDateKey(dt),
          timeLabel: dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          dueAt: dt.getTime(),
          description: String(a.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200),
          url: a.html_url || td.html_url || '',
        });
      }
    }
  }

  const existingAll = await db.plannerItems.toArray();
  const byUid = new Map(existingAll.filter(x => x.externalUid).map(x => [x.externalUid, x]));

  const todayKey = localDateKey();
  const newlyAddedAnnouncements = [];
  let archivedPast = 0;

  for (const item of fetchedItems) {
    const prev = byUid.get(item.externalUid);
    if (prev) {
      // Never overwrite user's `done` / submitted check-off or `pinned` state on re-sync!
      await db.plannerItems.update(prev.id, {
        title: item.title,
        course: item.course,
        author: item.author || prev.author || '',
        dateKey: item.dateKey,
        detectedDateKey: item.detectedDateKey || prev.detectedDateKey || '',
        timeLabel: item.timeLabel,
        dueAt: item.dueAt,
        description: item.description,
        url: item.url,
        updatedAt: Date.now(),
      });
      updated += 1;
    } else {
      // Canvas .ics feeds export old already-submitted/graded assignments from earlier in the term;
      // auto-archive newly imported past-due items as done (user can still uncheck in Show Completed).
      const isPastOnImport =
        item.type !== 'announcement' &&
        Boolean(item.dateKey) &&
        item.dateKey < todayKey;
      await db.plannerItems.add({
        ...item,
        done: isPastOnImport,
        autoArchivedPast: isPastOnImport,
        priority: item.type === 'exam' ? 'high' : 'normal',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      added += 1;
      if (isPastOnImport) archivedPast += 1;
      if (item.type === 'announcement') newlyAddedAnnouncements.push(item);
    }
  }

  const now = Date.now();
  saveCanvasSettings({ lastSync: now });
  syncDeadlineNotifications().catch(() => {});
  if (newlyAddedAnnouncements.length > 0) {
    notifyNewCanvasAnnouncements(newlyAddedAnnouncements).catch(() => {});
  }
  return { added, updated, archivedPast, total: fetchedItems.length, syncedAt: now };
}

/** 1-tap cleanup: mark all already-past incomplete tasks as submitted/done & clear overdue alerts. */
export async function markPastTasksDone() {
  const todayKey = localDateKey();
  const all = await db.plannerItems.toArray().catch(() => []);
  const pastPending = all.filter(
    it => !it.done && it.type !== 'announcement' && it.dateKey && it.dateKey < todayKey
  );
  for (const it of pastPending) {
    await db.plannerItems.update(it.id, { done: true, updatedAt: Date.now() });
  }
  syncDeadlineNotifications().catch(() => {});
  return pastPending.length;
}

let inFlightAutoSync = null;

/**
 * Automatically sync Canvas feeds (.ics + course .atom RSS) in the background when
 * the app opens, resumes from background, or opens School Planner (throttled to 15 min).
 */
export async function autoSyncCanvasIfStale({ minIntervalMs = 15 * 60 * 1000, force = false } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ran: false, reason: 'offline' };
  }
  const cfg = getCanvasSettings();
  const hasAnyFeed = Boolean(cfg.icsUrl || cfg.rssUrls || (cfg.host && cfg.token));
  if (!hasAnyFeed) return { ran: false, reason: 'unconfigured' };
  if (!force && !cfg.autoSync) return { ran: false, reason: 'disabled' };
  if (!force && cfg.lastSync && Date.now() - cfg.lastSync < minIntervalMs) {
    return { ran: false, reason: 'fresh' };
  }
  if (inFlightAutoSync) return inFlightAutoSync;

  inFlightAutoSync = syncCanvasFeeds({
    icsUrl: cfg.icsUrl,
    rssUrls: cfg.rssUrls,
    host: cfg.host,
    token: cfg.token,
  })
    .then(res => ({ ran: true, ...res }))
    .catch(err => ({ ran: false, error: err?.message || 'Canvas auto-sync failed' }))
    .finally(() => {
      inFlightAutoSync = null;
    });

  return inFlightAutoSync;
}
