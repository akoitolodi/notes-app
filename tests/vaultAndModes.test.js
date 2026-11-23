import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  sha256Hex,
  setupVaultPin,
  verifyVaultPin,
  lockVault,
  isVaultUnlocked,
  clearVaultPin,
} from '../src/lib/vault.js';
import {
  resolveNoteMode,
  isZeroAiMode,
  getChatModeDirective,
  getScanModeDirective,
} from '../src/lib/noteModes.js';
import {
  db,
  ensureSeeded,
  createFolder,
  deleteFolder,
  renameFolder,
  updateFolder,
  createNote,
  updateNote,
  getHomeSummary,
  getNotesInFolder,
  searchNotes,
  getDueFlashcards,
  SYSTEM_VAULT_FOLDER_NAME,
} from '../src/store/db.js';

// Minimal localStorage shim for Node Vitest environment
const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear(),
};

describe('PIN Private Vault & Multi-Life Modes', () => {
  beforeEach(async () => {
    memStore.clear();
    clearVaultPin();
    await db.folders.clear();
    await db.notes.clear();
    await db.examCache.clear();
    await db.attachments.clear();
  });

  it('hashes PIN with SHA-256 and verifies correctly', async () => {
    const knownHash = await sha256Hex('abc');
    expect(knownHash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    await setupVaultPin('2468', 'even digits');
    expect(isVaultUnlocked()).toBe(true);
    lockVault();
    expect(isVaultUnlocked()).toBe(false);

    expect(await verifyVaultPin('1111')).toBe(false);
    expect(isVaultUnlocked()).toBe(false);

    expect(await verifyVaultPin('2468')).toBe(true);
    expect(isVaultUnlocked()).toBe(true);
  });

  it('strictly hides locked folder notes from All Notes, Search, Tags, and Daily Review', async () => {
    await setupVaultPin('1234');
    const schoolId = await createFolder('Algorithms', { mode: 'code', locked: false });
    const diaryId = await createFolder('Personal Diary', { mode: 'journal', locked: true });

    const n1 = await createNote(schoolId, 'QuickSort', 'Divide and conquer #dsa');
    await updateNote(n1.id, { flashcards: [{ q: 'Avg Big-O?', a: '$O(n \\log n)$' }] });

    const n2 = await createNote(diaryId, 'Late Night Rant', 'Secret stress #private');
    await updateNote(n2.id, { flashcards: [{ q: 'Never quiz diary', a: 'Nope' }] });

    // Lock vault -> diary must disappear from every global view
    lockVault();
    const summaryLocked = await getHomeSummary();
    expect(summaryLocked.totalNotes).toBe(1);
    expect(summaryLocked.tags.map(t => t.name)).toEqual(['dsa']);

    const allLocked = await getNotesInFolder('__all__');
    expect(allLocked.map(n => n.title)).toEqual(['QuickSort']);

    const searchLocked = await searchNotes('Secret');
    expect(searchLocked).toHaveLength(0);

    const dueLocked = await getDueFlashcards();
    expect(dueLocked.totalCards).toBe(1);

    // Unlock vault -> diary is accessible in All Notes & Search, still excluded from flashcards (journal mode)
    await verifyVaultPin('1234');
    const allUnlocked = await getNotesInFolder('__all__');
    expect(allUnlocked).toHaveLength(2);

    const dueUnlocked = await getDueFlashcards();
    expect(dueUnlocked.totalCards).toBe(1);
  });

  it('routes folder & note mode personas cleanly and enforces Zero-AI on vault folders', () => {
    expect(resolveNoteMode({ mode: null }, { mode: 'journal' })).toBe('journal');
    expect(resolveNoteMode({ mode: 'explore' }, { mode: 'study' })).toBe('explore');
    expect(resolveNoteMode({ mode: 'study' }, { mode: 'vault', isSystemVault: true })).toBe('vault');
    expect(isZeroAiMode('vault')).toBe(true);
    expect(isZeroAiMode('study')).toBe(false);
    expect(getChatModeDirective('journal')).toMatch(/NEVER grade/i);
    expect(getScanModeDirective('journal')).toMatch(/"mistake": null/i);
    expect(getChatModeDirective('explore')).toMatch(/pop-science myths/i);
    expect(getChatModeDirective('code')).toMatch(/Big-O/i);
  });

  it('seeds fixed Passwords & Keys Zero-AI folder, hides it when locked, and prevents deletion or unlocking', async () => {
    await ensureSeeded();
    await setupVaultPin('9876');
    lockVault();

    // While locked: Passwords & Keys must be completely invisible from folders and vaultFolders
    const lockedSummary = await getHomeSummary();
    expect(lockedSummary.folders.some(f => f.name === SYSTEM_VAULT_FOLDER_NAME)).toBe(false);
    expect(lockedSummary.vaultFolders).toHaveLength(0);
    expect(lockedSummary.hiddenVaultCount).toBe(1);

    // Unlock vault: Passwords & Keys appears in vaultFolders (and still not in public folders)
    await verifyVaultPin('9876');
    const unlockedSummary = await getHomeSummary();
    expect(unlockedSummary.folders.some(f => f.name === SYSTEM_VAULT_FOLDER_NAME)).toBe(false);
    expect(unlockedSummary.vaultFolders).toHaveLength(1);
    const sysVault = unlockedSummary.vaultFolders[0];
    expect(sysVault.name).toBe('Passwords & Keys');
    expect(sysVault.isSystemVault).toBe(true);
    expect(sysVault.mode).toBe('vault');
    expect(sysVault.locked).toBe(true);

    // Cannot delete, rename, or remove lock from Passwords & Keys
    await expect(deleteFolder(sysVault.id)).rejects.toThrow(/cannot be deleted/i);
    await expect(renameFolder(sysVault.id, 'Hacked')).rejects.toThrow(/cannot be renamed/i);
    await updateFolder(sysVault.id, { locked: false, mode: 'study' });
    const afterUpdate = await db.folders.get(sysVault.id);
    expect(afterUpdate.locked).toBe(true);
    expect(afterUpdate.mode).toBe('vault');
  });
});
