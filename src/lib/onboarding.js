/**
 * onboarding — Pure fresh-install trigger logic and interactive starter content
 * kept separate from the lazy-loaded OnboardingGuideModal UI for zero cold-start overhead.
 */
import { db, createFolder, createNote } from '../store/db';

export const ONBOARDING_DONE_KEY = 'aicn:onboardingDone:v1';
export const SETUP_BANNER_DISMISSED_KEY = 'aicn:setupBannerDismissed';

/**
 * Auto-open the guided setup wizard ONLY on genuinely fresh installs
 * (no notes, no courses, no saved AI key, and not previously completed).
 */
export function shouldAutoShowOnboarding({
  onboardingDone = false,
  noteCount = 0,
  courseCount = 0,
  hasApiKey = false,
} = {}) {
  if (onboardingDone) return false;
  if ((Number(noteCount) || 0) > 0) return false;
  if ((Number(courseCount) || 0) > 0) return false;
  if (Boolean(hasApiKey)) return false;
  return true;
}

export function isOnboardingDone() {
  try {
    return localStorage.getItem(ONBOARDING_DONE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markOnboardingDone() {
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
  } catch {
    // ignore storage errors
  }
}

export const STARTER_WELCOME_TITLE = 'Welcome to Notes by Bai — Try These!';
export const STARTER_WELCOME_BODY = `# Interactive Quick-Start Note

Tap **Edit** to test offline Smart Auto-Detection right inside this note:

## 1. Live Math & Equation Solver (100% Offline)
2x + 5 = 17
25% of 480
sqrt(144) + 2^5

## 2. Instant Runnable Code (100% Offline JS)
\`\`\`js
const quiz = 38, total = 50;
const pct = (quiz / total) * 100;
console.log("Score:", pct + "%", pct >= 75 ? "PASSED" : "FAILED");
\`\`\`

## 3. Instant Offline Flashcards (Term: Definition)
Algorithm: A step-by-step procedure for solving a problem or computation.
IndexedDB: Local offline browser/app database storing all notes safely on your device.
Base-50 Grading: Transmutes a raw score using 50 + 50 × (score / total).

## 4. Today's Quick Setup Checklist
- [ ] Import your Class Schedule / COR PDF under Courses
- [ ] Connect a free Groq or Gemini key in Settings (optional)
- [ ] Add your Canvas calendar or announcements link
`;

export async function createStarterContent({
  createWelcomeNote = true,
  extraFolders = [],
} = {}) {
  const existingFolders = await db.folders.toArray().catch(() => []);
  const createdFolders = [];

  for (const name of extraFolders) {
    const clean = String(name || '').trim();
    if (!clean) continue;
    const exists = existingFolders.some(
      f => !f.locked && String(f.name || '').toLowerCase() === clean.toLowerCase()
    );
    if (!exists) {
      const id = await createFolder(clean, { mode: 'study', locked: false });
      createdFolders.push({ id, name: clean });
    }
  }

  let welcomeNote = null;
  let welcomeFolder = null;
  if (createWelcomeNote) {
    welcomeFolder =
      existingFolders.find(f => !f.locked && f.name === 'General') ||
      existingFolders.find(f => !f.locked && !f.isSystemVault) ||
      null;
    const existingNotes = await db.notes.toArray().catch(() => []);
    const dup = existingNotes.find(n => !n.deleted && n.title === STARTER_WELCOME_TITLE);
    if (dup) {
      welcomeNote = dup;
    } else {
      welcomeNote = await createNote(
        welcomeFolder?.id ?? null,
        STARTER_WELCOME_TITLE,
        STARTER_WELCOME_BODY,
        'General'
      );
    }
  }

  return { createdFolders, welcomeNote, welcomeFolder };
}
