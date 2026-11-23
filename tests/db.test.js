import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  ensureSeeded,
  createFolder,
  deleteFolder,
  createNote,
  updateNote,
  restoreNote,
  getTrash,
  noteHasContent,
  searchNotes,
  exportBackup,
  importBackup,
} from '../src/store/db.js';

describe('src/store/db (IndexedDB v4)', () => {
  beforeEach(async () => {
    await db.attachments.clear();
    await db.examCache.clear();
    await db.notes.clear();
    await db.folders.clear();
    await ensureSeeded();
  });

  it('preserves image-only and drawing-only notes via noteHasContent', () => {
    expect(noteHasContent({ title: '', body: '', images: [], drawings: { strokes: [] } })).toBe(false);
    expect(noteHasContent({ title: '', body: '', images: [{ id: 'img-1' }], drawings: { strokes: [] } })).toBe(true);
    expect(
      noteHasContent({
        title: '',
        body: '',
        images: [],
        drawings: { strokes: [{ tool: 'pen', points: [{ x: 1, y: 1 }] }] },
      })
    ).toBe(true);
  });

  it('moves folder notes to Trash, purges examCache, and safely restores orphaned notes to General', async () => {
    const bioId = await createFolder('Biology');
    const note = await createNote(bioId, 'Cell Theory', 'All organisms are made of cells.');
    await db.examCache.put({ folderId: bioId, result: { summary: 'test' }, at: Date.now() });

    await deleteFolder(bioId);

    // Exam cache cleaned up
    expect(await db.examCache.get(bioId)).toBeUndefined();
    // Note safely moved to Trash (not permanently lost!)
    const trash = await getTrash();
    expect(trash.map(n => n.id)).toContain(note.id);

    // Restoring a note whose original folder was deleted reassigns it to General
    await restoreNote(note.id);
    const restored = await db.notes.get(note.id);
    expect(restored.trashed).toBe(false);
    const targetFolder = await db.folders.get(restored.folderId);
    expect(targetFolder.name).toBe('General');
  });

  it('searches across title, body, AND AI explanations/terms', async () => {
    const fid = await createFolder('Physics');
    const n = await createNote(fid, 'Optics', 'Light bends across media');
    await updateNote(n.id, {
      blocks: [
        {
          id: 'line-1',
          text: 'Light bends across media',
          explanation: 'This phenomenon is called refraction.',
          terms: [{ term: 'Snell Law', definition: 'n1 sin θ1 = n2 sin θ2' }],
        },
      ],
    });

    const byExpl = await searchNotes('refraction', fid);
    const byTerm = await searchNotes('snell', fid);
    expect(byExpl.map(x => x.id)).toEqual([n.id]);
    expect(byTerm.map(x => x.id)).toEqual([n.id]);
  });

  it('exports and imports JSON backups cleanly', async () => {
    const fid = await createFolder('Chemistry');
    await createNote(fid, 'Acids', 'pH < 7 is acidic #chem');

    const backup = await exportBackup();
    expect(backup.app).toBe('ai-class-notes');
    expect(backup.notes.length).toBe(1);

    await db.notes.clear();
    await db.folders.clear();

    const imported = await importBackup(backup, { mode: 'replace' });
    expect(imported.notesAdded).toBe(1);
    const allNotes = await db.notes.toArray();
    expect(allNotes[0].title).toBe('Acids');
  });
});
