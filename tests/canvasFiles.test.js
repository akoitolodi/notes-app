import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { get: async () => ({ status: 200, data: '' }) },
}));

vi.mock('@capacitor/local-notifications', () => {
  const impl = {
    requestPermissions: async () => ({ display: 'granted' }),
    checkPermissions: async () => ({ display: 'granted' }),
    cancel: async () => ({}),
    schedule: async () => ({ notifications: [] }),
  };
  const LocalNotifications = new Proxy(impl, {
    get(target, prop) {
      if (prop === 'then') {
        throw new Error('LocalNotifications.then() is not implemented on android');
      }
      return target[prop];
    },
  });
  return { LocalNotifications };
});

import {
  normalizeCanvasHost,
  inferCanvasHost,
  matchCanvasCourseToLocal,
  discoverCourseFiles,
  diffNewCanvasFiles,
  extractSuggestedModuleName,
  matchSharedFileToCourse,
} from '../src/lib/canvasFiles';
import { extractImportableFileLinks } from '../src/lib/courseExtras';
import { notifyNewCanvasFiles } from '../src/lib/notifications';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

describe('Canvas Course Files Engine & Smart Fallbacks', () => {
  it('normalizes and infers Canvas host from settings or ICS/RSS URLs', () => {
    expect(normalizeCanvasHost('hnu.instructure.com/courses/12')).toBe('https://hnu.instructure.com');
    expect(normalizeCanvasHost('https://HNU.INSTRUCTURE.COM/')).toBe('https://hnu.instructure.com');
    expect(
      inferCanvasHost({
        host: '',
        icsUrl: 'https://campus.instructure.com/feeds/calendars/user_abc.ics',
        rssUrls: '',
      })
    ).toBe('https://campus.instructure.com');
    expect(
      inferCanvasHost({
        host: '',
        icsUrl: '',
        rssUrls: 'https://school.instructure.com/feeds/announcements/enrollment_xyz.atom',
      })
    ).toBe('https://school.instructure.com');
  });

  it('matches Canvas API courses to local Course cards with section guard', () => {
    const localCourses = [
      { id: 1, code: 'IPT 101', name: 'Integrative Programming and Technologies', section: 'A' },
      { id: 2, code: 'IPT 101', name: 'Integrative Programming and Technologies', section: 'C' },
      { id: 3, code: 'IAS 101', name: 'Information Assurance and Security' },
    ];

    const cHit = matchCanvasCourseToLocal(
      { id: 901, name: 'C - Integrative Programming and Technologies', course_code: 'IPT 101' },
      localCourses
    );
    expect(cHit?.id).toBe(2);

    const aHit = matchCanvasCourseToLocal(
      { id: 902, name: 'A - Integrative Programming and Technologies', course_code: 'IPT 101' },
      localCourses
    );
    expect(aHit?.id).toBe(1);

    const directIdHit = matchCanvasCourseToLocal(
      { id: 777, name: 'Random Name', course_code: 'RAND' },
      [{ id: 9, code: 'CS', name: 'Other', canvasCourseId: '777' }]
    );
    expect(directIdHit?.id).toBe(9);
  });

  it('discovers files from both Modules and Files API and survives 403 Files-tab lock', async () => {
    const fetcher = async url => {
      if (url.includes('/modules')) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: 10,
              name: 'Module 3: REST APIs',
              items: [
                { id: 101, type: 'File', content_id: 501, title: 'REST Architecture.pdf' },
                {
                  id: 102,
                  type: 'ExternalUrl',
                  title: 'Week 3 Deck',
                  external_url: 'https://docs.google.com/presentation/d/1AbCdEfGh/edit',
                },
              ],
            },
          ],
        };
      }
      if (url.includes('/files?')) {
        // Simulate professor hiding the Files navigation tab
        return { ok: false, status: 403, data: null };
      }
      if (url.includes('/files/501')) {
        return {
          ok: true,
          status: 200,
          data: {
            id: 501,
            display_name: 'REST Architecture.pdf',
            filename: 'REST_Architecture.pdf',
            size: 1450000,
            'content-type': 'application/pdf',
            updated_at: '2026-11-28T10:00:00Z',
            url: 'https://hnu.instructure.com/files/501/download?verifier=xyz',
          },
        };
      }
      return { ok: false, status: 404, data: null };
    };

    const files = await discoverCourseFiles({
      host: 'https://hnu.instructure.com',
      canvasCourse: { id: 42, course_code: 'IPT 101', name: 'IPT 101' },
      localCourse: { id: 2, code: 'IPT 101', name: 'Integrative Programming' },
      fetcher,
    });

    expect(files).toHaveLength(2);
    const pdf = files.find(f => f.canvasFileId === '501');
    expect(pdf?.moduleName).toBe('Module 3: REST APIs');
    expect(pdf?.size).toBe(1450000);
    expect(pdf?.localCourseId).toBe(2);

    const ext = files.find(f => f.sourceKind === 'external');
    expect(ext?.moduleName).toBe('Module 3: REST APIs');
    expect(ext?.downloadUrl).toContain('docs.google.com/presentation/d/1AbCdEfGh');
  });

  it('caps first-sync New flags to 5 recent files and flags newly added files on subsequent syncs', () => {
    const now = Date.UTC(2026, 10, 29);
    const list = Array.from({ length: 8 }, (_, idx) => ({
      canvasFileId: String(idx + 1),
      updatedAt: idx < 7 ? now - idx * 3600 * 1000 : now - 40 * 24 * 3600 * 1000,
    }));

    const first = diffNewCanvasFiles(list, { isFirstSync: true, nowMs: now });
    expect(first.newlyDetected).toHaveLength(5);
    expect(first.nextSeenIds).toHaveLength(3); // 2 older recent + 1 40-day-old marked seen

    const second = diffNewCanvasFiles(
      [{ canvasFileId: '99', updatedAt: now }, ...list],
      { seenIds: ['1', '2', '3', '4', '5', '6', '7', '8'], isFirstSync: false, nowMs: now }
    );
    expect(second.newlyDetected.map(x => x.canvasFileId)).toEqual(['99']);
  });

  it('extracts importable Google Docs, Slides, Drive files and direct PDF/PPTX links from announcements', () => {
    const links = extractImportableFileLinks({
      description:
        'Download slides: https://docs.google.com/presentation/d/slide123/edit and handout https://drive.google.com/file/d/drv456/view?usp=sharing and syllabus https://example.edu/files/Week2_Notes.pdf',
    });
    expect(links.map(l => l.kind)).toEqual(['Google Slides', 'Google Drive File', 'PDF']);
  });

  it('auto-matches shared filenames to local courses and suggests module names', () => {
    expect(extractSuggestedModuleName('IPT101_Module_4_REST_API.pdf')).toBe('Module 4');
    expect(extractSuggestedModuleName('Week5-Database-Normalization.pptx')).toBe('Week 5');

    const courses = [
      { id: 1, code: 'GE 102', name: 'Readings in Philippine History' },
      { id: 2, code: 'IPT 101', name: 'Integrative Programming and Technologies' },
    ];
    const match = matchSharedFileToCourse('IPT101_Module_4_REST_API.pdf', '', courses);
    expect(match.course?.id).toBe(2);
    expect(match.suggestedModule).toBe('Module 4');

    const none = matchSharedFileToCourse('random_screenshot_123.pdf', '', courses);
    expect(none.course).toBeNull();
  });

  it('notifies cleanly via Capacitor LocalNotifications Proxy without accessing .then', async () => {
    await expect(
      notifyNewCanvasFiles([
        {
          canvasFileId: '501',
          courseCode: 'IPT 101',
          displayName: 'REST Architecture.pdf',
          moduleName: 'Module 3',
        },
      ])
    ).resolves.toBeUndefined();
  });

  it('registers BaiNativeCanvas safely in MainActivity.java without leaking cookies on S3 redirects', () => {
    const java = fs.readFileSync(
      path.join(root, 'android/app/src/main/java/com/philipjohn/aiclassnotes/MainActivity.java'),
      'utf8'
    );
    expect(java).toContain('initNativeCanvas()');
    expect(java).toContain('BaiNativeCanvas');
    expect(java).toContain('setInstanceFollowRedirects(false)');
    expect(java).toContain('isSameOrSubHost');
    expect(java).toContain('takeResult');
    expect(java).toContain('dismissCanvasLoginDialog');
  });
});
