import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
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

import { db, ensureSeeded } from '../src/store/db';
import {
  requestNotificationPermission,
  syncDeadlineNotifications,
  notifyNewCanvasAnnouncements,
} from '../src/lib/notifications';

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

describe('v2.0.7 Android Notification Proxy Fix, High Refresh Rate & Clean Read Mode', () => {
  it('never accesses .then on Capacitor LocalNotifications Proxy during native notification calls', async () => {
    const granted = await requestNotificationPermission();
    expect(granted).toBe(true);

    const syncRes = await syncDeadlineNotifications();
    expect(syncRes).toEqual({ scheduledCount: 0, stickyActive: false });

    await expect(
      notifyNewCanvasAnnouncements([{ id: 1, title: 'Quiz Friday', course: 'CS' }])
    ).resolves.toBeUndefined();
  });

  it('moves Find related notes out of the reading canvas into the NoteEditor More menu', () => {
    const editorSrc = fs.readFileSync(path.join(root, 'src/components/NoteEditor.jsx'), 'utf8');
    expect(editorSrc).not.toContain('className="related-trigger"');
    const moreSheetStart = editorSrc.indexOf('moreOpen &&');
    const exportSheetStart = editorSrc.indexOf('exportOpen &&');
    expect(moreSheetStart).toBeGreaterThan(-1);
    const moreSheet = editorSrc.slice(moreSheetStart, exportSheetStart);
    expect(moreSheet).toContain('Find related notes');
  });

  it('configures 90Hz/120Hz+ display modes on Android and coalesces StrokeLayer draws via rAF', () => {
    const java = fs.readFileSync(
      path.join(root, 'android/app/src/main/java/com/philipjohn/aiclassnotes/MainActivity.java'),
      'utf8'
    );
    expect(java).toContain('enableHighRefreshRate');
    expect(java).toContain('preferredDisplayModeId');
    expect(java).toContain('preferredRefreshRate');
    expect(java).toContain('onResume');

    const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('android:hardwareAccelerated="true"');

    const strokeSrc = fs.readFileSync(path.join(root, 'src/components/StrokeLayer.jsx'), 'utf8');
    expect(strokeSrc).toContain('moveRafRef');
    expect(strokeSrc).toContain('scheduleRedraw');
  });

  it('eliminates startup white flash across Android styles, activity layout, MainActivity, and index.html', () => {
    const lightStyles = fs.readFileSync(
      path.join(root, 'android/app/src/main/res/values/styles.xml'),
      'utf8'
    );
    const nightStyles = fs.readFileSync(
      path.join(root, 'android/app/src/main/res/values-night/styles.xml'),
      'utf8'
    );
    const actLayout = fs.readFileSync(
      path.join(root, 'android/app/src/main/res/layout/activity_main.xml'),
      'utf8'
    );
    const java = fs.readFileSync(
      path.join(root, 'android/app/src/main/java/com/philipjohn/aiclassnotes/MainActivity.java'),
      'utf8'
    );
    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    expect(lightStyles).toContain('android:windowBackground');
    expect(lightStyles).toContain('windowSplashScreenBackground');
    expect(nightStyles).toContain('android:windowBackground');
    expect(nightStyles).toContain('windowSplashScreenBackground');
    expect(actLayout).toContain('android:background="?android:attr/windowBackground"');
    expect(java).toContain('applySavedWindowBackground');
    expect(java).toContain('BaiNativeTheme');
    expect(java).toContain('setBackgroundColor');
    expect(indexHtml).toContain('--boot-bg');
  });
});

describe('v2.0.8 Android Splash ActionBar, Single-Pass Keyboard Insets & Editor Viewport Lock', () => {
  it('never calls applySavedWindowBackground before super.onCreate and handles insets in one pass', () => {
    const java = fs.readFileSync(
      path.join(root, 'android/app/src/main/java/com/philipjohn/aiclassnotes/MainActivity.java'),
      'utf8'
    );
    const onCreateMatch = java.match(/protected void onCreate[\s\S]*?\n    \}/);
    expect(onCreateMatch).not.toBeNull();
    const superIdx = onCreateMatch[0].indexOf('super.onCreate(savedInstanceState)');
    const bgIdx = onCreateMatch[0].indexOf('applySavedWindowBackground()');
    expect(superIdx).toBeGreaterThan(-1);
    expect(bgIdx).toBeGreaterThan(superIdx);

    expect(java).toContain('WindowCompat.setDecorFitsSystemWindows');
    expect(java).toContain('installCleanWindowInsets');
    expect(java).toContain('WindowInsetsCompat.Type.ime()');
    expect(java).toContain('WindowInsetsControllerCompat');
  });

  it('removes android:background=@drawable/splash and locks NoActionBar on launch themes', () => {
    for (const rel of [
      'android/app/src/main/res/values/styles.xml',
      'android/app/src/main/res/values-night/styles.xml',
    ]) {
      const xml = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(xml).not.toContain('android:background">@drawable/splash');
      const launchBlock = xml.slice(xml.indexOf('AppTheme.NoActionBarLaunch'));
      expect(launchBlock).toContain('name="windowActionBar">false');
      expect(launchBlock).toContain('name="windowNoTitle">true');
    }

    const manifest = fs.readFileSync(
      path.join(root, 'android/app/src/main/AndroidManifest.xml'),
      'utf8'
    );
    expect(manifest).toContain('android:windowSoftInputMode="adjustResize"');

    const capConfig = JSON.parse(
      fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8')
    );
    expect(capConfig.plugins?.SystemBars?.insetsHandling).toBe('disable');
  });

  it('locks overflow: hidden on viewport roots and .screen.screen-paper so editor chrome stays pinned', () => {
    const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
    const htmlBlock = css.match(/html,\s*\r?\nbody,\s*\r?\n#root\s*\{[\s\S]*?\}/);
    expect(htmlBlock).not.toBeNull();
    expect(htmlBlock[0]).toContain('overflow: hidden;');

    const appRootBlock = css.match(/\.app-root\s*\{[\s\S]*?\}/);
    expect(appRootBlock).not.toBeNull();
    expect(appRootBlock[0]).toContain('overflow: hidden;');
    expect(appRootBlock[0]).not.toContain('min-height: 100vh');

    const paperBlock = css.match(/\.screen\.screen-paper\s*\{[\s\S]*?\}/);
    expect(paperBlock).not.toBeNull();
    expect(paperBlock[0]).toContain('overflow: hidden;');
  });
});
