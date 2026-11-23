import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractDocxXmlToMarkdown, extractDocxText } from '../src/lib/docImporter.js';
import { htmlToCleanMarkdown } from '../src/lib/htmlToMarkdown.js';
import { retrieveCourseChunks } from '../src/lib/localRag.js';
import { loadSafeCourseChunks } from '../src/lib/courseAi.js';
import { buildDeadlineSchedules } from '../src/lib/notifications.js';
import {
  setSlowNetworkSetting,
  isSlowNetworkActive,
  getAdaptiveTimeouts,
  fetchWithRetry,
} from '../src/lib/netResilience.js';
import {
  db,
  buildMaterialChunks,
  saveCourseMaterialWithChunks,
  deleteCourseMaterial,
  discoverCoursesFromPlanner,
} from '../src/store/db.js';
import { markPastTasksDone } from '../src/lib/canvasSync.js';

const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('Offline .docx Extractor & Rich Canvas Page HTML-to-Markdown', () => {
  it('extracts Word (.docx) headings, bullets, paragraphs & tables offline via fflate', async () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Module 1: REST APIs</w:t></w:r></w:p>
          <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Stateless client-server communication</w:t></w:r></w:p>
          <w:tbl>
            <w:tr><w:tc><w:p><w:r><w:t>Method</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Action</w:t></w:r></w:p></w:tc></w:tr>
            <w:tr><w:tc><w:p><w:r><w:t>GET</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Read resource</w:t></w:r></w:p></w:tc></w:tr>
          </w:tbl>
        </w:body>
      </w:document>`;

    const mdDirect = extractDocxXmlToMarkdown(docXml);
    expect(mdDirect).toContain('# Module 1: REST APIs');
    expect(mdDirect).toContain('- Stateless client-server communication');
    expect(mdDirect).toContain('| Method | Action |');
    expect(mdDirect).toContain('| GET | Read resource |');

    const zipped = zipSync({ 'word/document.xml': strToU8(docXml) });
    const res = await extractDocxText(zipped.buffer);
    expect(res.markdown).toContain('# Module 1: REST APIs');
    expect(res.pageCount).toBeGreaterThanOrEqual(1);
  });

  it('converts copied Canvas Module HTML into clean Markdown preserving links, tables & code', () => {
    const html = `
      <h2>Week 2: Sockets</h2>
      <p>Read the <strong>official</strong> guide at <a href="https://docs.example.com/tcp">TCP Docs</a>.</p>
      <ul><li>Three-way handshake</li><li>Port numbers</li></ul>
      <pre><code>socket.listen(8080)</code></pre>
      <table><tr><th>Protocol</th><th>Reliable</th></tr><tr><td>TCP</td><td>Yes</td></tr></table>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).toContain('## Week 2: Sockets');
    expect(md).toContain('**official**');
    expect(md).toContain('[TCP Docs](https://docs.example.com/tcp)');
    expect(md).toContain('- Three-way handshake');
    expect(md).toContain('socket.listen(8080)');
    expect(md).toContain('| Protocol | Reliable |');
  });
});

describe('Course Dashboard, Indexed Module Chunks & Course-Scoped BM25 AI RAG', () => {
  beforeEach(async () => {
    await db.courses.clear();
    await db.courseMaterials.clear();
    await db.materialChunks.clear();
    await db.plannerItems.clear();
    await db.folders.clear();
    await db.notes.clear();
  });

  it('auto-discovers courses from synced Canvas items and indexes uploaded files for selective BM25 RAG', async () => {
    await db.plannerItems.add({
      title: 'Lab 1',
      course: 'IPT 101A - Integrative Programming',
      type: 'assignment',
      source: 'canvas',
      dateKey: '2026-12-01',
      done: false,
    });

    const added = await discoverCoursesFromPlanner();
    expect(added).toBe(1);
    const [course] = await db.courses.toArray();
    expect(course.name).toBe('IPT 101A - Integrative Programming');

    const mat1 = await saveCourseMaterialWithChunks({
      courseId: course.id,
      moduleName: 'Module 1',
      title: 'REST_Slides.pptx',
      kind: 'pptx',
      extractedText: '## Slide 1\nREST stands for Representational State Transfer.\n\n## Slide 2\nHTTP status codes 200 OK and 404 Not Found.',
      pageCount: 2,
    });
    const mat2 = await saveCourseMaterialWithChunks({
      courseId: course.id,
      moduleName: 'Module 2',
      title: 'GraphQL_Notes.docx',
      kind: 'docx',
      extractedText: '## GraphQL Queries\nGraphQL lets clients request exact nested fields in a single endpoint.',
      pageCount: 1,
    });

    const allChunks = await db.materialChunks.where('courseId').equals(course.id).toArray();
    expect(allChunks.length).toBeGreaterThanOrEqual(3);

    const hits = retrieveCourseChunks(allChunks, 'HTTP status codes 404 REST', { topK: 2 });
    expect(hits[0].materialId).toBe(mat1.id);
    expect(hits[0].citation).toContain('Module 1');

    // Exam-week selective module filter restricts RAG strictly to Module 2
    const scopedHits = retrieveCourseChunks(allChunks, 'HTTP REST GraphQL', {
      topK: 4,
      materialIds: [mat2.id],
    });
    expect(scopedHits.every(h => h.materialId === mat2.id)).toBe(true);

    // Clean cascade delete removes materialChunks too
    await deleteCourseMaterial(mat1.id);
    const afterDelete = await db.materialChunks.where('materialId').equals(mat1.id).toArray();
    expect(afterDelete.length).toBe(0);
  });

  it('strictly excludes locked/Zero-AI Vault folders from Course AI chunk loading', async () => {
    const vaultId = await db.folders.add({
      name: 'Passwords & Keys',
      mode: 'vault',
      locked: true,
      isSystemVault: true,
      createdAt: Date.now(),
    });
    await db.notes.add({
      folderId: vaultId,
      title: 'My Secret Password',
      body: 'SUPER_SECRET_PASSWORD_123',
      mode: 'vault',
    });
    const courseId = await db.courses.add({
      code: 'SEC 101',
      name: 'Security',
      folderId: vaultId,
      createdAt: Date.now(),
    });
    const course = await db.courses.get(courseId);
    const chunks = await loadSafeCourseChunks(course);
    expect(chunks.some(c => c.text.includes('SUPER_SECRET_PASSWORD_123'))).toBe(false);
    expect(buildMaterialChunks('# Intro\nHello world').length).toBe(1);
  });
});

describe('Persistent Due-Date Notifications & Slow-Internet Resilience', () => {
  it('schedules 24h, 3h, exam 7AM reminders and sticky ongoing alerts only for incomplete urgent items', () => {
    const now = new Date('2026-11-24T08:00:00').getTime();
    const items = [
      {
        id: 1,
        title: 'Midterm Exam',
        course: 'CS 201',
        type: 'exam',
        dateKey: '2026-11-26',
        dueAt: new Date('2026-11-26T14:00:00').getTime(),
        done: false,
      },
      {
        id: 2,
        title: 'Lab Due Today',
        course: 'IPT 101',
        type: 'assignment',
        dateKey: '2026-11-24',
        dueAt: new Date('2026-11-24T23:59:00').getTime(),
        done: false,
      },
      {
        id: 3,
        title: 'Already Finished',
        course: 'IPT 101',
        type: 'assignment',
        dateKey: '2026-11-24',
        dueAt: new Date('2026-11-24T23:59:00').getTime(),
        done: true,
      },
    ];

    const res = buildDeadlineSchedules(items, now, { stickyOngoing: true });
    // Midterm gets 24h + 3h + 7am exam day; Lab Due Today gets 3h
    expect(res.scheduled.some(n => n.title.includes('Due Tomorrow') && n.title.includes('Midterm Exam'))).toBe(true);
    expect(res.scheduled.some(n => n.title.includes('Exam Today') && n.title.includes('Midterm Exam'))).toBe(true);
    expect(res.scheduled.some(n => n.title.includes('Already Finished'))).toBe(false);
    expect(res.sticky).not.toBeNull();
    expect(res.sticky.ongoing).toBe(true);
    expect(res.sticky.body).toContain('Lab Due Today');
    expect(res.sticky.body).not.toContain('Already Finished');
  });

  it('widens adaptive timeouts in Slow Internet Mode and retries transient network errors cleanly', async () => {
    setSlowNetworkSetting('on');
    expect(isSlowNetworkActive()).toBe(true);
    const slowT = getAdaptiveTimeouts();
    expect(slowT.aiFirstByteMs).toBeGreaterThanOrEqual(45000);
    expect(slowT.ragTopK).toBe(4);

    setSlowNetworkSetting('off');
    expect(isSlowNetworkActive()).toBe(false);
    const fastT = getAdaptiveTimeouts();
    expect(fastT.ragTopK).toBe(6);

    let attempts = 0;
    const mockFetch = async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      if (attempts === 2) return { ok: false, status: 503 };
      return { ok: true, status: 200, text: async () => 'OK' };
    };

    const res = await fetchWithRetry('https://example.com/feed.ics', {}, {
      retries: 2,
      backoffBaseMs: 10,
      fetchImpl: mockFetch,
    });
    expect(attempts).toBe(3);
    expect(res.status).toBe(200);
  });

  it('marks already-past tasks as done via markPastTasksDone without touching future tasks', async () => {
    await db.plannerItems.clear();
    await db.plannerItems.add({
      title: 'Already Graded Old Lab',
      course: 'IPT 101A',
      type: 'assignment',
      source: 'canvas',
      dateKey: '2025-01-15',
      done: false,
    });
    await db.plannerItems.add({
      title: 'Upcoming Future Quiz',
      course: 'IPT 101A',
      type: 'exam',
      source: 'canvas',
      dateKey: '2099-12-15',
      done: false,
    });

    const cleared = await markPastTasksDone();
    expect(cleared).toBe(1);
    const items = await db.plannerItems.toArray();
    expect(items.find(x => x.title === 'Already Graded Old Lab').done).toBe(true);
    expect(items.find(x => x.title === 'Upcoming Future Quiz').done).toBe(false);
  });
});
