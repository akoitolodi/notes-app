/**
 * canvasFiles — Hybrid Canvas Professor-Uploaded Files Engine:
 * 1. Native Android WebView Session Auth (works even with Personal Access Tokens disabled)
 * 2. Dual-endpoint Course File Discovery (/modules + /files with 403 Files-tab fallback)
 * 3. New-file diffing, selective 1-tap download & offline RAG indexing
 * 4. Smart Share-to-Course & Suggested-Module auto-matcher
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { db, saveCourseMaterialWithChunks, logStudyActivity } from '../store/db';
import { extractDocument, titleFromFilename } from './docImporter';
import { fetchCanvasText, getCanvasSettings } from './canvasSync';
import { resolveAnnouncementCourse, parseCanvasCourseLabel } from './announcementSchedule';
import { getPublicGoogleExportUrl, importPublicGoogleLink } from './courseExtras';
import { notifyNewCanvasFiles } from './notifications';

export const CANVAS_FILES_CATALOG_KEY = 'aicn:canvasFilesCatalog:v1';
export const CANVAS_FILES_SEEN_KEY = 'aicn:canvasFilesSeenIds:v1';
export const CANVAS_FILES_IMPORTED_KEY = 'aicn:canvasFilesImportedMap:v1';
export const CANVAS_FILES_LAST_CHECK_KEY = 'aicn:canvasFilesLastCheck:v1';
export const CANVAS_SESSION_META_KEY = 'aicn:canvasSessionMeta:v1';
export const CANVAS_FILES_UPDATED_EVENT = 'bai-canvas-files-updated';

const FIRST_SYNC_NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const FIRST_SYNC_MAX_NEW = 5;
const SUPPORTED_EXT_RE = /\.(?:pdf|pptx?|docx?|md|markdown|txt|csv|rtf|png|jpe?g)$/i;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'course',
  'module', 'modules', 'week', 'lecture', 'slides', 'slide', 'handout',
  'notes', 'lesson', 'chapter', 'part', 'file', 'document', 'pdf', 'pptx', 'docx',
]);

function dispatchCatalogUpdated() {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent(CANVAS_FILES_UPDATED_EVENT));
    }
  } catch {
    // non-fatal
  }
}

export function normalizeCanvasHost(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname) return '';
    return `https://${u.hostname.toLowerCase()}`;
  } catch {
    return '';
  }
}

export function inferCanvasHost(cfg = getCanvasSettings()) {
  const direct = normalizeCanvasHost(cfg?.host);
  if (direct) return direct;
  const candidates = [cfg?.icsUrl, ...(String(cfg?.rssUrls || '').split(/[\n,]+/))];
  for (const raw of candidates) {
    const clean = String(raw || '').trim();
    if (!clean) continue;
    const norm = normalizeCanvasHost(clean);
    if (norm) return norm;
  }
  return '';
}

export function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function isSupportedStudyFile(fileName = '', contentType = '') {
  const name = String(fileName || '').trim().toLowerCase();
  const ct = String(contentType || '').trim().toLowerCase();
  if (name && SUPPORTED_EXT_RE.test(name)) return true;
  if (
    ct.includes('pdf') ||
    ct.includes('presentation') ||
    ct.includes('powerpoint') ||
    ct.includes('wordprocessing') ||
    ct.includes('msword') ||
    ct.startsWith('text/plain') ||
    ct.startsWith('text/markdown') ||
    ct.startsWith('image/png') ||
    ct.startsWith('image/jpeg')
  ) {
    return true;
  }
  return false;
}

function getNativeCanvasBridge() {
  if (typeof window === 'undefined') return null;
  return window.BaiNativeCanvas || null;
}

export function isNativeCanvasAvailable() {
  const b = getNativeCanvasBridge();
  try {
    return Boolean(b && b.isAvailable && b.isAvailable());
  } catch {
    return false;
  }
}

export function hasNativeCanvasSession(host) {
  const norm = normalizeCanvasHost(host);
  const b = getNativeCanvasBridge();
  if (!norm || !b?.hasSession) return false;
  try {
    return Boolean(b.hasSession(norm));
  } catch {
    return false;
  }
}

function getSessionMeta() {
  try {
    const raw = JSON.parse(localStorage.getItem(CANVAS_SESSION_META_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveSessionMeta(patch) {
  try {
    const next = { ...getSessionMeta(), ...patch };
    localStorage.setItem(CANVAS_SESSION_META_KEY, JSON.stringify(next));
  } catch {
    // ignore storage limits
  }
}

/** Open the native Android WebView login sheet on the student's school Canvas host. */
export function openNativeCanvasLogin(host) {
  const norm = normalizeCanvasHost(host);
  if (!norm) return Promise.reject(new Error('Enter your school Canvas URL (e.g. school.instructure.com).'));
  const b = getNativeCanvasBridge();
  if (!b?.openLogin) {
    return Promise.reject(new Error('In-app Canvas sign-in is available in the Android app.'));
  }

  return new Promise(resolve => {
    let settled = false;
    const prevCb = window.__baiCanvasCallback;
    const finish = res => {
      if (settled) return;
      settled = true;
      window.__baiCanvasCallback = prevCb;
      if (res?.ok) {
        saveSessionMeta({
          host: normalizeCanvasHost(res.host) || norm,
          userName: String(res.userName || '').trim(),
          connectedAt: Date.now(),
        });
        dispatchCatalogUpdated();
      }
      resolve(res);
    };

    window.__baiCanvasCallback = (eventType, payloadJson) => {
      try {
        prevCb?.(eventType, payloadJson);
      } catch {
        // ignore chained callback errors
      }
      if (eventType !== 'login') return;
      let parsed = {};
      try {
        parsed = JSON.parse(payloadJson || '{}');
      } catch {
        parsed = { ok: false, error: 'Invalid login response' };
      }
      finish(parsed);
    };

    try {
      b.openLogin(norm);
    } catch (err) {
      finish({ ok: false, error: err?.message || 'Could not open Canvas login' });
    }
  });
}

export function clearNativeCanvasSession(host = '') {
  const b = getNativeCanvasBridge();
  try {
    b?.clearSession?.(normalizeCanvasHost(host));
  } catch {
    // non-fatal
  }
  try {
    localStorage.removeItem(CANVAS_SESSION_META_KEY);
  } catch {
    // non-fatal
  }
  dispatchCatalogUpdated();
}

const _pendingBridgeResolvers = new Map();
if (typeof window !== 'undefined') {
  window.__baiCanvasReady = reqId => {
    const entry = _pendingBridgeResolvers.get(reqId);
    if (!entry) return;
    _pendingBridgeResolvers.delete(reqId);
    clearTimeout(entry.timer);
    try {
      const raw = getNativeCanvasBridge()?.takeResult?.(reqId) || '';
      const parsed = JSON.parse(raw || '{}');
      entry.resolve(parsed);
    } catch (err) {
      entry.reject(err);
    }
  };
}

function callNativeBridgeAsync(methodName, url, timeoutMs = 25000) {
  const b = getNativeCanvasBridge();
  if (!b || typeof b[methodName] !== 'function') {
    return Promise.reject(new Error('Native Canvas bridge is not available.'));
  }
  const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingBridgeResolvers.delete(reqId);
      reject(new Error('Canvas request timed out.'));
    }, timeoutMs);
    _pendingBridgeResolvers.set(reqId, { resolve, reject, timer });
    try {
      b[methodName](reqId, url);
    } catch (err) {
      _pendingBridgeResolvers.delete(reqId);
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Fetch Canvas API JSON using native session cookies (or optional student token fallback).
 * Returns `{ status, ok, data, error }`.
 */
export async function canvasSessionFetchJson(url, { token = '' } = {}) {
  const b = getNativeCanvasBridge();
  if (b?.isAvailable?.() && hasNativeCanvasSession(url)) {
    const res = await callNativeBridgeAsync('fetchJsonAsync', url, 25000);
    if (!res?.ok) {
      return {
        ok: false,
        status: Number(res?.status || 0),
        data: null,
        error: res?.error || `Canvas returned HTTP ${res?.status || 0}`,
      };
    }
    let data = null;
    try {
      data = res.body ? JSON.parse(res.body) : null;
    } catch {
      data = null;
    }
    return { ok: true, status: Number(res.status || 200), data, error: '' };
  }

  if (token && String(token).trim()) {
    try {
      const raw = await fetchCanvasText(url, token);
      const clean = String(raw || '').replace(/^while\(1\);\s*/i, '').trim();
      return { ok: true, status: 200, data: clean ? JSON.parse(clean) : null, error: '' };
    } catch (err) {
      const statusMatch = /HTTP\s+(\d{3})/i.exec(err?.message || '');
      return {
        ok: false,
        status: statusMatch ? Number(statusMatch[1]) : 0,
        data: null,
        error: err?.message || 'Canvas fetch failed',
      };
    }
  }

  return { ok: false, status: 401, data: null, error: 'Canvas session required' };
}

export async function canvasSessionDownloadFile(url, { token = '' } = {}) {
  const b = getNativeCanvasBridge();
  if (b?.isAvailable?.() && (!token || hasNativeCanvasSession(url))) {
    const res = await callNativeBridgeAsync('downloadFileAsync', url, 35000);
    if (!res?.ok || !res?.base64) {
      throw new Error(res?.error || `Download failed (HTTP ${res?.status || 0})`);
    }
    return {
      base64: res.base64,
      contentType: res.contentType || 'application/octet-stream',
      fileName: res.fileName || '',
      size: Number(res.size || 0),
    };
  }

  if (Capacitor.isNativePlatform?.() && CapacitorHttp?.get) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await CapacitorHttp.get({ url, headers, responseType: 'arraybuffer' });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Download failed (HTTP ${res.status})`);
    }
    return {
      base64: typeof res.data === 'string' ? res.data : '',
      contentType: res.headers?.['content-type'] || 'application/octet-stream',
      fileName: '',
      size: 0,
    };
  }

  throw new Error('Sign in with Canvas on Android (or download manually & tap Upload) to download protected files.');
}

function base64ToUint8Array(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/** Match a Canvas API course object (`{ id, name, course_code }`) to a local `db.courses` card. */
export function matchCanvasCourseToLocal(canvasCourse, localCourses = []) {
  if (!canvasCourse || !Array.isArray(localCourses) || localCourses.length === 0) return null;
  const active = localCourses.filter(c => c && !c.archived);
  const cIdStr = canvasCourse.id != null ? String(canvasCourse.id) : '';
  if (cIdStr) {
    const directId = active.find(c => String(c.canvasCourseId || '') === cIdStr);
    if (directId) return directId;
  }

  const candidates = [canvasCourse.name, canvasCourse.course_code]
    .map(s => String(s || '').trim())
    .filter(Boolean);

  let best = null;
  let bestScore = 0;
  for (const label of candidates) {
    const hit = resolveAnnouncementCourse({ course: label }, active);
    if (hit && hit.score > bestScore) {
      bestScore = hit.score;
      best = hit.course;
    }
  }
  return best;
}

function inferExtFromContentType(ct = '') {
  const s = String(ct || '').toLowerCase();
  if (s.includes('pdf')) return 'pdf';
  if (s.includes('presentation') || s.includes('powerpoint')) return 'pptx';
  if (s.includes('wordprocessing') || s.includes('msword')) return 'docx';
  if (s.includes('markdown')) return 'md';
  if (s.includes('text/plain')) return 'txt';
  return 'pdf';
}

/**
 * Discover professor-uploaded files & importable document links inside a single Canvas course.
 * Combines Modules + Files and handles HTTP 403 on `/files` gracefully when professors hide the Files tab.
 */
export async function discoverCourseFiles({
  host,
  canvasCourse,
  localCourse = null,
  fetcher,
} = {}) {
  const baseHost = normalizeCanvasHost(host);
  const courseId = canvasCourse?.id;
  if (!baseHost || !courseId || typeof fetcher !== 'function') return [];

  const modulesUrl = `${baseHost}/api/v1/courses/${courseId}/modules?include[]=items&per_page=50`;
  const filesUrl = `${baseHost}/api/v1/courses/${courseId}/files?sort=updated_at&order=desc&per_page=50`;

  const [modRes, filesRes] = await Promise.all([
    fetcher(modulesUrl).catch(() => ({ ok: false, status: 0, data: null })),
    fetcher(filesUrl).catch(() => ({ ok: false, status: 0, data: null })),
  ]);

  if (modRes?.status === 401 && filesRes?.status === 401) {
    const err = new Error('Canvas session expired');
    err.status = 401;
    throw err;
  }

  const byFileId = new Map();
  const externalDocs = [];

  if (filesRes?.ok && Array.isArray(filesRes.data)) {
    for (const f of filesRes.data) {
      if (!f || f.locked || f.hidden || f.locked_for_user) continue;
      const fname = f.filename || f.display_name || '';
      const ct = f['content-type'] || f.content_type || '';
      if (!isSupportedStudyFile(fname, ct)) continue;
      const fid = String(f.id);
      byFileId.set(fid, {
        canvasFileId: fid,
        canvasCourseId: String(courseId),
        localCourseId: localCourse?.id ?? null,
        courseCode: localCourse?.code || canvasCourse.course_code || canvasCourse.name || 'Course',
        courseName: localCourse?.nickname || localCourse?.name || canvasCourse.name || '',
        moduleName: 'Course Files',
        displayName: f.display_name || fname || 'Untitled File',
        fileName: fname || f.display_name || 'material.pdf',
        contentType: ct,
        size: Number(f.size || 0),
        updatedAt: f.updated_at ? new Date(f.updated_at).getTime() : f.created_at ? new Date(f.created_at).getTime() : 0,
        downloadUrl: f.url || `${baseHost}/api/v1/courses/${courseId}/files/${fid}`,
        htmlUrl: f.html_url || `${baseHost}/courses/${courseId}/files/${fid}`,
        sourceKind: 'canvas',
      });
    }
  }

  const missingModuleFileItems = [];
  if (modRes?.ok && Array.isArray(modRes.data)) {
    for (const mod of modRes.data) {
      if (!mod || mod.locked) continue;
      const modTitle = String(mod.name || 'Module').trim() || 'Module';
      const items = Array.isArray(mod.items) ? mod.items : [];
      for (const item of items) {
        if (!item) continue;
        if (item.type === 'File' && item.content_id != null) {
          const fid = String(item.content_id);
          const existing = byFileId.get(fid);
          if (existing) {
            existing.moduleName = modTitle;
            if (item.title && (!existing.displayName || existing.displayName === existing.fileName)) {
              existing.displayName = item.title;
            }
          } else {
            missingModuleFileItems.push({ fid, modTitle, item });
          }
        } else if (item.type === 'ExternalUrl' && item.external_url) {
          const gExp = getPublicGoogleExportUrl(item.external_url);
          const extSupported = Boolean(gExp) || isSupportedStudyFile(item.external_url);
          if (extSupported) {
            externalDocs.push({
              canvasFileId: `ext:${courseId}:${item.id || item.external_url}`,
              canvasCourseId: String(courseId),
              localCourseId: localCourse?.id ?? null,
              courseCode: localCourse?.code || canvasCourse.course_code || canvasCourse.name || 'Course',
              courseName: localCourse?.nickname || localCourse?.name || canvasCourse.name || '',
              moduleName: modTitle,
              displayName: item.title || gExp?.kind || 'Shared Material',
              fileName: item.title || 'material',
              contentType: '',
              size: 0,
              updatedAt: 0,
              downloadUrl: item.external_url,
              htmlUrl: item.html_url || item.external_url,
              sourceKind: 'external',
            });
          }
        }
      }
    }
  }

  // If professor hid the Files tab (403 on /files), resolve individual module File items!
  if (missingModuleFileItems.length > 0) {
    const queue = missingModuleFileItems.slice(0, 25);
    const results = await Promise.all(
      queue.map(async ({ fid, modTitle, item }) => {
        const target = item.url || `${baseHost}/api/v1/courses/${courseId}/files/${fid}`;
        const fRes = await fetcher(target).catch(() => null);
        if (!fRes?.ok || !fRes.data) return null;
        const f = fRes.data;
        if (f.locked || f.hidden || f.locked_for_user) return null;
        const fname = f.filename || f.display_name || item.title || '';
        const ct = f['content-type'] || f.content_type || '';
        if (!isSupportedStudyFile(fname, ct)) return null;
        return {
          canvasFileId: fid,
          canvasCourseId: String(courseId),
          localCourseId: localCourse?.id ?? null,
          courseCode: localCourse?.code || canvasCourse.course_code || canvasCourse.name || 'Course',
          courseName: localCourse?.nickname || localCourse?.name || canvasCourse.name || '',
          moduleName: modTitle,
          displayName: f.display_name || item.title || fname,
          fileName: fname || `${item.title || 'material'}.${inferExtFromContentType(ct)}`,
          contentType: ct,
          size: Number(f.size || 0),
          updatedAt: f.updated_at ? new Date(f.updated_at).getTime() : f.created_at ? new Date(f.created_at).getTime() : 0,
          downloadUrl: f.url || target,
          htmlUrl: f.html_url || item.html_url || `${baseHost}/courses/${courseId}/files/${fid}`,
          sourceKind: 'canvas',
        };
      })
    );
    for (const r of results) {
      if (r) byFileId.set(r.canvasFileId, r);
    }
  }

  return [...byFileId.values(), ...externalDocs].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );
}

/**
 * Flag newly uploaded Canvas files cleanly.
 * On first sync, only flag up to 5 recent files (<= 14 days old) as New and auto-mark older history seen.
 */
export function diffNewCanvasFiles(
  discoveredFiles = [],
  { seenIds = [], importedMap = {}, isFirstSync = false, nowMs = Date.now() } = {}
) {
  const seenSet = new Set(Array.isArray(seenIds) ? seenIds : []);
  const sorted = [...discoveredFiles].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const newlyDetected = [];

  if (isFirstSync) {
    let flaggedCount = 0;
    const files = sorted.map(f => {
      const imported = Boolean(importedMap?.[f.canvasFileId]);
      const isRecent = Boolean(f.updatedAt) && nowMs - f.updatedAt <= FIRST_SYNC_NEW_WINDOW_MS;
      const isNew = !imported && isRecent && flaggedCount < FIRST_SYNC_MAX_NEW;
      if (isNew) {
        flaggedCount += 1;
        newlyDetected.push(f);
      } else {
        seenSet.add(f.canvasFileId);
      }
      return { ...f, isNew, isImported: imported };
    });
    return { files, newlyDetected, nextSeenIds: [...seenSet].slice(-600) };
  }

  const files = sorted.map(f => {
    const imported = Boolean(importedMap?.[f.canvasFileId]);
    const isNew = !imported && !seenSet.has(f.canvasFileId);
    if (isNew) newlyDetected.push(f);
    return { ...f, isNew, isImported: imported };
  });

  return { files, newlyDetected, nextSeenIds: [...seenSet].slice(-600) };
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export function getCanvasFilesSnapshot() {
  const catalog = readJsonStorage(CANVAS_FILES_CATALOG_KEY, null);
  const seenIds = readJsonStorage(CANVAS_FILES_SEEN_KEY, []);
  const importedMap = readJsonStorage(CANVAS_FILES_IMPORTED_KEY, {});
  const seenSet = new Set(Array.isArray(seenIds) ? seenIds : []);
  const sessionMeta = getSessionMeta();

  const rawFiles = Array.isArray(catalog?.files) ? catalog.files : [];
  const enriched = rawFiles.map(f => {
    const isImported = Boolean(importedMap?.[f.canvasFileId]);
    const isNew = !isImported && !seenSet.has(f.canvasFileId);
    return { ...f, isImported, isNew };
  });

  const newFiles = enriched.filter(f => f.isNew);
  const unimportedFiles = enriched.filter(f => !f.isImported);
  const byCourseId = new Map();
  for (const f of enriched) {
    if (f.localCourseId == null) continue;
    const k = String(f.localCourseId);
    if (!byCourseId.has(k)) {
      byCourseId.set(k, { files: [], newFiles: [], newCount: 0, unimportedCount: 0 });
    }
    const bucket = byCourseId.get(k);
    bucket.files.push(f);
    if (f.isNew) {
      bucket.newFiles.push(f);
      bucket.newCount += 1;
    }
    if (!f.isImported) bucket.unimportedCount += 1;
  }

  return {
    host: catalog?.host || sessionMeta.host || '',
    userName: catalog?.userName || sessionMeta.userName || '',
    updatedAt: catalog?.updatedAt || 0,
    courses: Array.isArray(catalog?.courses) ? catalog.courses : [],
    files: enriched,
    newFiles,
    newCount: newFiles.length,
    unimportedFiles,
    importedMap,
    byCourseId,
  };
}

export function markCanvasFilesSeen(fileIds = null) {
  const seen = new Set(readJsonStorage(CANVAS_FILES_SEEN_KEY, []));
  const targets = Array.isArray(fileIds)
    ? fileIds
    : (readJsonStorage(CANVAS_FILES_CATALOG_KEY, null)?.files || []).map(f => f.canvasFileId);
  for (const id of targets) {
    if (id) seen.add(String(id));
  }
  writeJsonStorage(CANVAS_FILES_SEEN_KEY, [...seen].slice(-600));
  dispatchCatalogUpdated();
}

export function markCanvasFileImported(canvasFileId, materialId = null) {
  if (!canvasFileId) return;
  const importedMap = readJsonStorage(CANVAS_FILES_IMPORTED_KEY, {});
  importedMap[String(canvasFileId)] = { at: Date.now(), materialId };
  writeJsonStorage(CANVAS_FILES_IMPORTED_KEY, importedMap);

  const seen = new Set(readJsonStorage(CANVAS_FILES_SEEN_KEY, []));
  seen.add(String(canvasFileId));
  writeJsonStorage(CANVAS_FILES_SEEN_KEY, [...seen].slice(-600));
  dispatchCatalogUpdated();
}

export async function linkCanvasCourseIdInCatalog(canvasCourseId, localCourse) {
  if (!canvasCourseId || !localCourse) return;
  await db.courses.update(localCourse.id, { canvasCourseId: String(canvasCourseId) }).catch(() => {});
  const catalog = readJsonStorage(CANVAS_FILES_CATALOG_KEY, null);
  if (!catalog) return;
  const cIdStr = String(canvasCourseId);
  if (Array.isArray(catalog.courses)) {
    catalog.courses = catalog.courses.map(c =>
      String(c.id) === cIdStr ? { ...c, localCourseId: localCourse.id } : c
    );
  }
  if (Array.isArray(catalog.files)) {
    catalog.files = catalog.files.map(f =>
      String(f.canvasCourseId) === cIdStr
        ? {
            ...f,
            localCourseId: localCourse.id,
            courseCode: localCourse.code || f.courseCode,
            courseName: localCourse.nickname || localCourse.name || f.courseName,
          }
        : f
    );
  }
  writeJsonStorage(CANVAS_FILES_CATALOG_KEY, catalog);
  dispatchCatalogUpdated();
}

/**
 * Full live Canvas Files sync across active enrollments using native WebView cookies
 * (or optional Access Token fallback).
 */
export async function syncCanvasFilesCatalog({
  host = '',
  courses = null,
  fetcher = null,
  notify = true,
} = {}) {
  const cfg = getCanvasSettings();
  const baseHost = normalizeCanvasHost(host) || normalizeCanvasHost(getSessionMeta().host) || inferCanvasHost(cfg);
  if (!baseHost) {
    throw new Error('Enter your school Canvas domain first (e.g. hnu.instructure.com).');
  }

  const useFetcher = fetcher || (url => canvasSessionFetchJson(url, { token: cfg.token }));
  const coursesRes = await useFetcher(`${baseHost}/api/v1/courses?enrollment_state=active&per_page=50`);
  if (!coursesRes.ok) {
    if (coursesRes.status === 401 || coursesRes.status === 403) {
      return { sessionExpired: true, courses: [], files: [], newlyDetected: [] };
    }
    throw new Error(coursesRes.error || `Canvas returned HTTP ${coursesRes.status}`);
  }

  const canvasCoursesRaw = Array.isArray(coursesRes.data)
    ? coursesRes.data.filter(c => c && !c.access_restricted_by_date && c.name)
    : [];
  const localCourses = Array.isArray(courses) ? courses : await db.courses.toArray().catch(() => []);

  const matchedCanvasCourses = [];
  for (const cc of canvasCoursesRaw) {
    const local = matchCanvasCourseToLocal(cc, localCourses);
    if (local && !local.canvasCourseId) {
      db.courses.update(local.id, { canvasCourseId: String(cc.id) }).catch(() => {});
    }
    matchedCanvasCourses.push({
      id: String(cc.id),
      code: cc.course_code || '',
      name: cc.name || '',
      localCourseId: local?.id ?? null,
    });
  }

  // Bounded concurrency (3 courses at once) to stay crisp & polite to school servers
  const allDiscovered = [];
  for (let i = 0; i < matchedCanvasCourses.length; i += 3) {
    const batch = matchedCanvasCourses.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map(async mc => {
        const rawCourse = canvasCoursesRaw.find(c => String(c.id) === mc.id);
        const localCourse = localCourses.find(lc => lc.id === mc.localCourseId) || null;
        return discoverCourseFiles({
          host: baseHost,
          canvasCourse: rawCourse,
          localCourse,
          fetcher: useFetcher,
        }).catch(err => {
          if (err?.status === 401) throw err;
          return [];
        });
      })
    );
    for (const arr of batchResults) allDiscovered.push(...arr);
  }

  const prevCatalog = readJsonStorage(CANVAS_FILES_CATALOG_KEY, null);
  const prevIds = new Set((prevCatalog?.files || []).map(f => f.canvasFileId));
  const seenIds = readJsonStorage(CANVAS_FILES_SEEN_KEY, []);
  const importedMap = readJsonStorage(CANVAS_FILES_IMPORTED_KEY, {});
  const isFirstSync = !prevCatalog;

  const { files, newlyDetected, nextSeenIds } = diffNewCanvasFiles(allDiscovered, {
    seenIds,
    importedMap,
    isFirstSync,
  });

  const now = Date.now();
  const sessionMeta = getSessionMeta();
  const nextCatalog = {
    host: baseHost,
    userName: sessionMeta.userName || prevCatalog?.userName || '',
    updatedAt: now,
    courses: matchedCanvasCourses,
    files: files.slice(0, 400),
  };

  writeJsonStorage(CANVAS_FILES_CATALOG_KEY, nextCatalog);
  writeJsonStorage(CANVAS_FILES_SEEN_KEY, nextSeenIds);
  writeJsonStorage(CANVAS_FILES_LAST_CHECK_KEY, now);
  dispatchCatalogUpdated();

  const freshToNotify = isFirstSync
    ? newlyDetected
    : newlyDetected.filter(f => !prevIds.has(f.canvasFileId));
  if (notify && freshToNotify.length > 0) {
    notifyNewCanvasFiles(freshToNotify).catch(() => {});
  }

  return {
    sessionExpired: false,
    courses: matchedCanvasCourses,
    files,
    newlyDetected,
    syncedAt: now,
  };
}

let inFlightFileCheck = null;

export async function autoCheckCanvasFilesIfStale({
  minIntervalMs = 15 * 60 * 1000,
  force = false,
} = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ran: false, reason: 'offline' };
  }
  const cfg = getCanvasSettings();
  const host = normalizeCanvasHost(getSessionMeta().host) || inferCanvasHost(cfg);
  if (!host) return { ran: false, reason: 'unconfigured' };
  const hasAuth = hasNativeCanvasSession(host) || Boolean(cfg.token);
  if (!hasAuth) return { ran: false, reason: 'no-session' };

  const lastCheck = Number(readJsonStorage(CANVAS_FILES_LAST_CHECK_KEY, 0)) || 0;
  if (!force && lastCheck && Date.now() - lastCheck < minIntervalMs) {
    return { ran: false, reason: 'fresh' };
  }
  if (inFlightFileCheck) return inFlightFileCheck;

  inFlightFileCheck = syncCanvasFilesCatalog({ host, notify: true })
    .then(res => ({ ran: true, ...res }))
    .catch(err => ({ ran: false, error: err?.message || 'Canvas file check failed' }))
    .finally(() => {
      inFlightFileCheck = null;
    });

  return inFlightFileCheck;
}

/**
 * Download & extract a single detected Canvas file (or external Google link) and index it
 * directly into the target local Course's Modules library for Course AI Tutor.
 */
export async function importCanvasFileToCourse(
  fileRec,
  targetCourse,
  { onProgress = null, moduleNameOverride = '' } = {}
) {
  if (!fileRec || !targetCourse?.id) {
    throw new Error('Select a local course first.');
  }

  const moduleName =
    String(moduleNameOverride || fileRec.moduleName || 'Canvas Modules').trim() || 'Canvas Modules';

  if (fileRec.sourceKind === 'external' && getPublicGoogleExportUrl(fileRec.downloadUrl)) {
    const info = getPublicGoogleExportUrl(fileRec.downloadUrl);
    if (info.kind === 'Google Doc' || info.kind === 'Google Slides') {
      const gRes = await importPublicGoogleLink(fileRec.downloadUrl);
      const saved = await saveCourseMaterialWithChunks({
        courseId: targetCourse.id,
        moduleName,
        title: fileRec.displayName || gRes.title,
        kind: gRes.kind,
        extractedText: gRes.extractedText,
        pageCount: gRes.pageCount,
        sourceUrl: fileRec.downloadUrl,
      });
      await logStudyActivity('notes', 1);
      markCanvasFileImported(fileRec.canvasFileId, saved?.id);
      return saved;
    }
  }

  const downloadTarget = getPublicGoogleExportUrl(fileRec.downloadUrl)?.exportUrl || fileRec.downloadUrl;
  const cfg = getCanvasSettings();
  const dl = await canvasSessionDownloadFile(downloadTarget, { token: cfg.token });
  const bytes = base64ToUint8Array(dl.base64);
  const chosenName = dl.fileName || fileRec.fileName || `${fileRec.displayName || 'material'}.pdf`;
  const fileObj = new File([bytes], chosenName, {
    type: dl.contentType || fileRec.contentType || 'application/octet-stream',
  });

  const extracted = await extractDocument(fileObj, { onProgress });
  const saved = await saveCourseMaterialWithChunks({
    courseId: targetCourse.id,
    moduleName,
    title: fileRec.displayName ? titleFromFilename(fileRec.displayName) : extracted.title,
    kind: extracted.kind,
    fileName: chosenName,
    extractedText: extracted.rawMarkdown,
    pageCount: extracted.pageCount,
    sourceUrl: fileRec.htmlUrl || fileRec.downloadUrl || '',
    fileBlob: fileObj,
    mime: fileObj.type || '',
  });
  await logStudyActivity('notes', 1);
  markCanvasFileImported(fileRec.canvasFileId, saved?.id);
  return saved;
}

/**
 * Download and import an arbitrary direct PDF/PPTX/DOCX/Google URL (from Announcements or Links)
 * straight into a Course Module.
 */
export async function importExternalLinkToCourse({
  url,
  title = '',
  targetCourse,
  moduleName = 'Shared Links',
  onProgress = null,
} = {}) {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl || !targetCourse?.id) {
    throw new Error('Missing link or course target.');
  }

  const gInfo = getPublicGoogleExportUrl(cleanUrl);
  if (gInfo && (gInfo.kind === 'Google Doc' || gInfo.kind === 'Google Slides')) {
    const gRes = await importPublicGoogleLink(cleanUrl);
    const saved = await saveCourseMaterialWithChunks({
      courseId: targetCourse.id,
      moduleName,
      title: title || gRes.title,
      kind: gRes.kind,
      extractedText: gRes.extractedText,
      pageCount: gRes.pageCount,
      sourceUrl: cleanUrl,
    });
    await logStudyActivity('notes', 1);
    return saved;
  }

  const fileRec = {
    canvasFileId: '',
    displayName: title || cleanUrl.split('/').pop()?.split('?')[0] || 'Course File',
    fileName: cleanUrl.split('/').pop()?.split('?')[0] || 'material.pdf',
    contentType: '',
    downloadUrl: gInfo?.exportUrl || cleanUrl,
    htmlUrl: cleanUrl,
    moduleName,
    sourceKind: 'direct',
  };
  return importCanvasFileToCourse(fileRec, targetCourse, {
    onProgress,
    moduleNameOverride: moduleName,
  });
}

/**
 * Suggest a clean Module name from a shared filename/title
 * (e.g. "IPT101_Module_4_REST_API.pdf" -> "Module 4", "Week5_Slides.pptx" -> "Week 5").
 */
export function extractSuggestedModuleName(fileName = '', title = '') {
  const clean = `${title || ''} ${fileName || ''}`
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';

  const patterns = [
    [/\b(?:module|mod)\s*(\d{1,2})\b/i, m => `Module ${m[1]}`],
    [/\b(?:week|wk)\s*(\d{1,2})\b/i, m => `Week ${m[1]}`],
    [/\b(?:chapter|chap|ch)\s*(\d{1,2})\b/i, m => `Chapter ${m[1]}`],
    [/\bunit\s*(\d{1,2})\b/i, m => `Unit ${m[1]}`],
    [/\b(?:lesson|lecture|lec)\s*(\d{1,2})\b/i, m => `Lesson ${m[1]}`],
    [/\b(prelims?|midterms?|semi-?finals?|finals?)\b/i, m => m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()],
  ];

  for (const [re, fmt] of patterns) {
    const match = re.exec(clean);
    if (match) return fmt(match);
  }
  return '';
}

function normAlnum(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Smart Share-to-Course Auto-Matcher:
 * Scores a shared or picked filename/title against enrolled active courses so
 * Share Sheet -> Notes by Bai pre-selects the right subject & module automatically.
 */
export function matchSharedFileToCourse(fileName = '', title = '', courses = []) {
  const suggestedModule = extractSuggestedModuleName(fileName, title);
  const raw = `${title || ''} ${fileName || ''}`
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw || !Array.isArray(courses) || courses.length === 0) {
    return { course: null, score: 0, suggestedModule };
  }

  const rawLower = raw.toLowerCase();
  const rawNorm = normAlnum(raw);
  const words = rawLower
    .split(/[^a-z0-9]+/)
    .filter(w => w && w.length >= 2 && !STOP_WORDS.has(w));
  const firstAlphaMatch = /^([a-z]{2,6})\s*\d+/i.exec(rawLower);

  let bestCourse = null;
  let bestScore = 0;
  let secondBest = 0;

  for (const c of courses) {
    if (!c || c.archived) continue;
    let score = 0;

    const codeNorm = normAlnum(c.code);
    const parsedCode = parseCanvasCourseLabel(c.code || '');
    const nickNorm = normAlnum(c.nickname);
    const tagNorm = normAlnum(c.icsCourseTag);
    const nameNorm = normAlnum(c.name);
    const aliases = Array.isArray(c.canvasAliases) ? c.canvasAliases : [];

    // Direct code / nickname / alias substring match inside alnum filename
    for (const [candidateNorm, pts] of [
      [codeNorm, 110],
      [nickNorm, 95],
      [tagNorm, 90],
      ...aliases.map(al => [normAlnum(al), 100]),
    ]) {
      if (candidateNorm && candidateNorm.length >= 3 && rawNorm.includes(candidateNorm)) {
        score = Math.max(score, pts);
      }
    }

    // Whole-name or substantial prefix match
    if (nameNorm && nameNorm.length >= 6 && rawNorm.includes(nameNorm)) {
      score = Math.max(score, 100);
    }

    // Partial code letters + course number (e.g. "IPT" + "101")
    const codeWords = String(c.code || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const codeAlpha = codeWords.find(w => /^[a-z]{2,}$/.test(w)) || '';
    const codeNums = codeWords.filter(w => /^\d+$/.test(w));
    if (score === 0 && codeAlpha && words.includes(codeAlpha)) {
      score += 42;
      if (codeNums.length > 0 && codeNums.some(n => words.includes(n))) {
        score += 45;
      }
    }

    // Subject name keyword overlap (>= 4 char tokens)
    const nameWords = String(c.name || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
    if (nameWords.length > 0) {
      let hits = 0;
      for (const nw of nameWords) {
        if (words.some(w => w === nw || (w.length >= 5 && nw.startsWith(w)))) {
          hits += 1;
        }
      }
      if (hits >= 2) score = Math.max(score, 55 + hits * 15);
      else if (hits === 1 && words.length <= 4) score = Math.max(score, 44);
    }

    // Acronym check ("IPT" -> "Integrative Programming Technologies")
    const nameAcronym = String(c.name || '')
      .split(/[^a-zA-Z]+/)
      .filter(w => w && !STOP_WORDS.has(w.toLowerCase()))
      .map(w => w[0].toLowerCase())
      .join('');
    if (score === 0 && nameAcronym.length >= 3) {
      if (words.includes(nameAcronym) || (firstAlphaMatch && firstAlphaMatch[1] === nameAcronym)) {
        score = Math.max(score, 54);
      }
    }

    // Section tie-breaker/guard if section token explicitly in course & filename
    if (score > 0 && c.section && parsedCode.section === '') {
      const secRe = new RegExp(`(?:^|[^a-z0-9])sec\\s*${String(c.section).replace(/[^a-z0-9]/gi, '')}(?:$|[^a-z0-9])`, 'i');
      if (secRe.test(rawLower)) score += 12;
    }

    if (score > bestScore) {
      secondBest = bestScore;
      bestScore = score;
      bestCourse = c;
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  if (!bestCourse || bestScore < 42) {
    return { course: null, score: 0, suggestedModule };
  }
  if (bestScore < 90 && secondBest > 0 && bestScore - secondBest < 10) {
    return { course: null, score: 0, suggestedModule };
  }

  return { course: bestCourse, score: bestScore, suggestedModule };
}
