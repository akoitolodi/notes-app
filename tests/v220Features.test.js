import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  filterScheduleEntries,
  countHiddenPairedLecs,
} from '../src/lib/scheduleView';
import { buildClassReminderSchedules } from '../src/lib/notifications';
import { solveArithmeticLine } from '../src/lib/mathSolver';
import { detectBlankNoteIntents } from '../src/lib/smartNoteDetect';
import {
  clearVaultPin,
  setupVaultPin,
  lockVault,
  unlockVaultSession,
  unlockDecoyVaultSession,
  getVaultSessionMode,
  getDecoyConfig,
  enableDecoyVault,
  updateDecoyTriggerDigit,
  disableDecoyVault,
} from '../src/lib/vault';
import {
  db,
  ensureSeeded,
  ensureDecoyVaultSeeded,
  createFolder,
  createNote,
  getHomeSummary,
  getFoldersWithCounts,
  SYSTEM_VAULT_FOLDER_NAME,
  DECOY_VAULT_FOLDER_NAME,
} from '../src/store/db';
import { generateQrMatrix, generateQrSvg } from '../src/lib/qrSvg';
import { enhancePixelsRgba } from '../src/lib/imageEnhance';

// Minimal localStorage shim for Node Vitest environment
const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('v2.2.0 Schedule Filtering, Arithmetic Detection, Stealth Decoy & Offline Utilities', () => {
  beforeEach(async () => {
    memStore.clear();
    clearVaultPin();
    lockVault();
    await db.folders.clear();
    await db.notes.clear();
    await db.courses.clear();
    await db.classSchedule.clear();
    await ensureSeeded();
  });

  it('hides paired LEC only when LAB exists while preserving lecture-only courses', () => {
    const entries = [
      { id: '1', code: 'IT 204', baseCode: 'IT 204', kind: 'LEC', dayOfWeek: 1, startTime: '08:00', endTime: '09:00', startMin: 480, endMin: 540 },
      { id: '2', code: 'IT 204L', baseCode: 'IT 204', kind: 'LAB', dayOfWeek: 3, startTime: '13:00', endTime: '16:00', startMin: 780, endMin: 960 },
      { id: '3', code: 'GE 101', baseCode: 'GE 101', kind: 'LEC', dayOfWeek: 2, startTime: '10:00', endTime: '11:30', startMin: 600, endMin: 690 },
      { id: '4', code: 'PATH FIT 4', baseCode: 'PATH FIT 4', kind: 'LEC', dayOfWeek: 4, startTime: '16:30', endTime: '17:30', startMin: 990, endMin: 1050 },
    ];

    expect(countHiddenPairedLecs(entries)).toBe(1);

    const noPaired = filterScheduleEntries(entries, 'no-paired-lec');
    expect(noPaired.map(e => `${e.code}:${e.kind}`)).toEqual([
      'IT 204L:LAB',
      'GE 101:LEC',
      'PATH FIT 4:LEC',
    ]);

    const allSlots = filterScheduleEntries(entries, 'all');
    expect(allSlots).toHaveLength(4);
  });

  it('builds weekly recurring closed-app class reminders honoring No Paired Lec filter', () => {
    const courses = [
      { id: 'c1', code: 'IT 204', name: 'Integrative Programming' },
      { id: 'c2', code: 'GE 101', name: 'Understanding the Self' },
    ];
    const scheduleRows = [
      { id: 's1', courseId: 'c1', courseCode: 'IT 204', kind: 'LEC', dayOfWeek: 1, startTime: '08:00', endTime: '09:00', room: 'Rm 301' },
      { id: 's2', courseId: 'c1', courseCode: 'IT 204', kind: 'LAB', dayOfWeek: 3, startTime: '13:00', endTime: '16:00', room: 'Lab 2' },
      { id: 's3', courseId: 'c2', courseCode: 'GE 101', kind: 'LEC', dayOfWeek: 2, startTime: '00:05', endTime: '01:05', room: 'Rm 105' },
    ];
    // Sunday 2026-11-22 12:00 local time
    const sundayNoon = new Date(2026, 10, 22, 12, 0, 0).getTime();

    const filtered = buildClassReminderSchedules(courses, scheduleRows, [], sundayNoon, {
      leadMinutes: 10,
      persistent: false,
      filterMode: 'no-paired-lec',
    });
    expect(filtered).toHaveLength(2);
    const labSched = filtered.find(s => s.title.includes('IT 204'));
    expect(labSched).toBeTruthy();
    // Wednesday (dayOfWeek 3) -> Capacitor weekday 4, 13:00 - 10m = 12:50
    expect(labSched.recurringOn).toEqual({ weekday: 4, hour: 12, minute: 50 });

    // Tuesday 00:05 minus 10m wraps to Monday 23:55 -> Capacitor weekday 2
    const wrapSched = filtered.find(s => s.title.includes('GE 101'));
    expect(wrapSched.recurringOn).toEqual({ weekday: 2, hour: 23, minute: 55 });

    const unfiltered = buildClassReminderSchedules(courses, scheduleRows, [], sundayNoon, {
      leadMinutes: 10,
      persistent: false,
      filterMode: 'all',
    });
    expect(unfiltered).toHaveLength(3);
  });

  it('solves simple arithmetic ops, word ops, x multiply, slash division, commas & avoids dates', () => {
    expect(solveArithmeticLine('10/2')?.answer).toBe('5');
    expect(solveArithmeticLine('5 x 6')?.answer).toBe('30');
    expect(solveArithmeticLine('1,500 + 250')?.answer).toBe('1750');
    expect(solveArithmeticLine('20 ÷ 4')?.answer).toBe('5');
    expect(solveArithmeticLine('8 − 3')?.answer).toBe('5');
    expect(solveArithmeticLine('6 × 7')?.answer).toBe('42');
    expect(solveArithmeticLine('12 plus 8')?.answer).toBe('20');
    expect(solveArithmeticLine('15 minus 4')?.answer).toBe('11');
    expect(solveArithmeticLine('3 times 9')?.answer).toBe('27');
    expect(solveArithmeticLine('20 divided by 5')?.answer).toBe('4');
    expect(solveArithmeticLine('Total: 50 + 25')?.answer).toBe('75');
    expect(solveArithmeticLine('11/25/2026')).toBeNull();

    // Even when earlier lines contain code keywords, arithmetic on the last line still triggers
    const noteBody = 'const x = getData();\nfunction test() { return 1; }\n10/2';
    const intents = detectBlankNoteIntents(noteBody, { isZeroAi: false, enabled: true });
    const mathIntent = intents.find(d => d.kind === 'math');
    expect(mathIntent?.meta?.kind).toBe('arithmetic');
    expect(mathIntent?.meta?.answer).toBe('5');
  });

  it('strictly isolates Locked, Stealth Decoy Vault, and Real Hidden Vault modes', async () => {
    await setupVaultPin('2580');

    // Create a hidden locked folder and a Vault password note in real storage
    const secretFolderId = await createFolder('Real Secret Exam', { locked: true, mode: 'vault' });
    await createNote({
      folderId: secretFolderId,
      title: 'Actual Exam Answer Key',
      body: 'Super secret real answer',
    });
    const sysFolder = (await db.folders.toArray()).find(f => f.name === SYSTEM_VAULT_FOLDER_NAME);
    expect(sysFolder).toBeTruthy();

    // Enable stealth decoy triggered by long-pressing '7'
    enableDecoyVault('7');
    expect(getDecoyConfig()).toEqual(expect.objectContaining({ enabled: true, triggerDigit: '7' }));

    // Mode 1: Locked -> neither real secret folder nor decoy folder shows up; disabling fails!
    lockVault();
    expect(getVaultSessionMode()).toBe('locked');
    expect(() => disableDecoyVault()).toThrow();
    const lockedFolders = await getFoldersWithCounts();
    expect(lockedFolders.some(f => f.name === 'Real Secret Exam')).toBe(false);
    expect(lockedFolders.some(f => f.name === DECOY_VAULT_FOLDER_NAME)).toBe(false);

    // Mode 2: Stealth Decoy unlocked -> sees Dummy Notes ONLY, NEVER sees real hidden folders or real system vault
    await ensureDecoyVaultSeeded();
    unlockDecoyVaultSession();
    expect(getVaultSessionMode()).toBe('decoy');
    expect(() => disableDecoyVault()).toThrow();
    expect(() => updateDecoyTriggerDigit('9')).toThrow();
    const decoySummary = await getHomeSummary();
    expect(decoySummary.vaultFolders.length).toBeGreaterThan(0);
    expect(decoySummary.vaultFolders[0].name).toBe(DECOY_VAULT_FOLDER_NAME);
    expect(decoySummary.decoyVaultFolders).toHaveLength(0); // Only revealed inside Real Vault controls
    expect(decoySummary.folders.some(f => f.name === 'Real Secret Exam')).toBe(false);
    expect(decoySummary.folders.some(f => f.name === SYSTEM_VAULT_FOLDER_NAME)).toBe(false);

    const decoyFolders = await getFoldersWithCounts();
    expect(decoyFolders.some(f => f.name === DECOY_VAULT_FOLDER_NAME)).toBe(true);
    expect(decoyFolders.some(f => f.name === 'Real Secret Exam')).toBe(false);
    expect(decoyFolders.some(f => f.name === SYSTEM_VAULT_FOLDER_NAME)).toBe(false);

    // Mode 3: Real Vault unlocked -> sees real hidden folders & system vault, NEVER shows decoy folder, CAN edit/disable decoy
    unlockVaultSession();
    expect(getVaultSessionMode()).toBe('real');
    updateDecoyTriggerDigit('9');
    expect(getDecoyConfig().triggerDigit).toBe('9');
    const realFolders = await getFoldersWithCounts();
    expect(realFolders.some(f => f.name === 'Real Secret Exam')).toBe(true);
    expect(realFolders.some(f => f.name === SYSTEM_VAULT_FOLDER_NAME)).toBe(true);
    expect(realFolders.some(f => f.name === DECOY_VAULT_FOLDER_NAME)).toBe(false);
    expect(disableDecoyVault()).toEqual({ enabled: false, triggerDigit: '7' });
    expect(getDecoyConfig().enabled).toBe(false);
  });

  it('generates offline scannable QR matrix and SVG markup for BaiDrop sharing', () => {
    const payload = 'BAIDROP1:eyJ2IjoxLCJraW5kIjoibm90ZSIsInRpdGxlIjoiQ1MxMDEifQ';
    const mat = generateQrMatrix(payload);
    expect(mat).toBeTruthy();
    expect(mat.size).toBeGreaterThanOrEqual(21);
    expect(mat.modules).toHaveLength(mat.size);

    const svg = generateQrSvg(payload, { pixelSize: 200 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#111111"');

    // Too large returns empty string gracefully
    expect(generateQrSvg('A'.repeat(4000))).toBe('');
  });

  it('enhances whiteboard and document RGBA buffers offline while preserving alpha', () => {
    // Simulated dim whiteboard: light-gray background pixels + dark ink pixels
    const buf = new Uint8ClampedArray([
      165, 168, 172, 255, // paper pixel 1
      170, 174, 176, 255, // paper pixel 2
      50, 55, 65, 255,    // ink pixel 1
      45, 50, 60, 255,    // ink pixel 2
    ]);

    const wb = enhancePixelsRgba(new Uint8ClampedArray(buf), 'whiteboard');
    expect(wb).toHaveLength(buf.length);
    // Paper brightened, ink darkened, alpha untouched
    expect(wb[0]).toBeGreaterThan(buf[0]);
    expect(wb[8]).toBeLessThan(buf[8]);
    expect(wb[3]).toBe(255);

    const doc = enhancePixelsRgba(new Uint8ClampedArray(buf), 'document');
    expect(doc).toHaveLength(buf.length);
    // Document mode forces monochrome grayscale B&W paper & ink
    expect(doc[0]).toBe(doc[1]);
    expect(doc[1]).toBe(doc[2]);
    expect(doc[0]).toBeGreaterThan(200);
    expect(doc[8]).toBeLessThan(70);
  });
});
