import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { db, ensureSeeded } from '../src/store/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

describe('v2.0.6 Cold-Startup & Boot Optimization Architecture', () => {
  it('ensureSeeded returns true only when mutating folders and false on subsequent calls', async () => {
    await db.folders.clear();
    const firstRun = await ensureSeeded();
    expect(firstRun).toBe(true);

    const secondRun = await ensureSeeded();
    expect(secondRun).toBe(false);
  });

  it('MainActivity registers BaiNativeTts in onCreate without eagerly constructing TextToSpeech', () => {
    const java = fs.readFileSync(
      path.join(root, 'android/app/src/main/java/com/philipjohn/aiclassnotes/MainActivity.java'),
      'utf8'
    );
    const onCreateMatch = java.match(/protected void onCreate[\s\S]*?\n    \}/);
    expect(onCreateMatch).not.toBeNull();
    expect(onCreateMatch[0]).toContain('initNativeTts()');

    const initTtsMatch = java.match(/private void initNativeTts\(\)[\s\S]*?\n    \}/);
    expect(initTtsMatch).not.toBeNull();
    expect(initTtsMatch[0]).toContain('BaiNativeTts');
    expect(initTtsMatch[0]).not.toContain('new TextToSpeech');

    expect(java).toContain('ensureTtsInitialized');
  });

  it('vite.config.js does not bundle all lucide-react icons into an eager chunk', () => {
    const viteCfg = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
    expect(viteCfg).not.toMatch(/icons:\s*\[\s*'lucide-react'\s*\]/);
  });

  it('App.jsx defers canvasSync/notifications, removes blocking splash overlay, and throttles trash purge', () => {
    const appSrc = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
    expect(appSrc).not.toMatch(/^import\s+.*from\s+['"]\.\/lib\/canvasSync['"]/m);
    expect(appSrc).not.toMatch(/^import\s+.*from\s+['"]\.\/lib\/notifications['"]/m);
    expect(appSrc).not.toContain('app-splash-overlay');
    expect(appSrc).toContain('LAST_TRASH_PURGE_KEY');
    expect(appSrc).toContain('TRASH_PURGE_INTERVAL_MS');
  });

  it('FoldersScreen dynamically loads templates & canvasSync and excludes vaultFolders from Home cache', () => {
    const foldersSrc = fs.readFileSync(path.join(root, 'src/components/FoldersScreen.jsx'), 'utf8');
    expect(foldersSrc).not.toMatch(/^import\s+.*from\s+['"]\.\.\/lib\/templates['"]/m);
    expect(foldersSrc).not.toMatch(/^import\s+.*from\s+['"]\.\.\/lib\/canvasSync['"]/m);
    expect(foldersSrc).toContain('HOME_CACHE_KEY');
    expect(foldersSrc).toContain('vaultFolders: []');
    expect(foldersSrc).toContain("import('../lib/templates')");
    expect(foldersSrc).toContain("import('../lib/canvasSync')");
  });
});
