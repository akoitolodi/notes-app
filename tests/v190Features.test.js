import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  extractCourseLinks,
  getPublicGoogleExportUrl,
  computeCourseGrade,
  computeSemesterGwa,
  computeAttendanceStatus,
  ATTENDANCE_PRESETS,
} from '../src/lib/courseExtras.js';
import { isSpeechSupported, speakSegment, stopSpeech } from '../src/lib/audioStudy.js';

describe('Auto-Pinned Course Links & Public Google Docs/Slides Importer', () => {
  it('extracts deduplicated Google Chat, Google Docs, Google Slides & Zoom links from announcements', () => {
    const anns = [
      {
        title: 'Welcome Post',
        dateKey: '2026-11-23',
        description:
          'Join [IPT 101A Chat](https://chat.google.com/room/abc123) and read [Week 1 Handout](https://docs.google.com/document/d/1AbCdEfGhIj/edit?usp=sharing).',
      },
      {
        title: 'Slides Posted',
        dateKey: '2026-11-24',
        description:
          'Slides here: https://docs.google.com/presentation/d/9ZyXwVuTsR/edit and join again at https://chat.google.com/room/abc123.',
      },
    ];

    const links = extractCourseLinks(anns);
    expect(links.length).toBe(3);
    expect(links[0].kind).toBe('Google Chat');
    expect(links[0].importable).toBe(false);
    expect(links[1].kind).toBe('Google Doc');
    expect(links[1].importable).toBe(true);
    expect(links[2].kind).toBe('Google Slides');
    expect(links[2].importable).toBe(true);

    const docExp = getPublicGoogleExportUrl(links[1].url);
    expect(docExp.exportUrl).toBe('https://docs.google.com/document/d/1AbCdEfGhIj/export?format=txt');
    const slideExp = getPublicGoogleExportUrl(links[2].url);
    expect(slideExp.exportUrl).toBe('https://docs.google.com/presentation/d/9ZyXwVuTsR/export/txt');
  });
});

describe('Per-Course Grades, Canvas What-If Simulator & Semester GWA', () => {
  it('computes weighted course standing, applies temporary What-If overrides, and rolls up Semester GWA', () => {
    const weights = [
      { id: 'q', name: 'Quizzes', weight: 40 },
      { id: 'f', name: 'Finals', weight: 60 },
    ];
    const entries = [
      { id: 'e1', categoryId: 'q', earned: 40, possible: 50 }, // 80%
      { id: 'e2', categoryId: 'f', earned: '', possible: 100 }, // ungraded yet
    ];

    const actual = computeCourseGrade({ weights, entries });
    expect(actual.standing).toBe(80);
    expect(actual.phGwa).toBe(2.5);

    // Canvas What-If: what if student gets 95/100 on the Final Exam?
    // Weighted: 80 * 0.4 + 95 * 0.6 = 32 + 57 = 89%
    const simulated = computeCourseGrade({ weights, entries, whatIfMap: { e2: 95 } });
    expect(simulated.standing).toBe(89);
    expect(simulated.phGwa).toBe(1.75);
    expect(simulated.usGpa).toBe(3.3);

    // Semester GWA across 2 courses (3 units each): 96% (1.00 GWA) & 90% (1.50 GWA) -> 1.25 GWA
    const sem = computeSemesterGwa([
      { units: 3, standing: 96 },
      { units: 3, standing: 90 },
    ]);
    expect(sem.courseCount).toBe(2);
    expect(sem.avgPercent).toBe(93);
    expect(sem.phGwa).toBe(1.25);
  });
});

describe('Customizable PH College Attendance & FDA Absence Guard', () => {
  it('calculates effective absences with Lates-to-Absence conversion and CHED risk levels accurately', () => {
    expect(ATTENDANCE_PRESETS.map(p => p.maxAbsences)).toEqual([10, 7, 3]);

    // 2 absences + 4 lates (with 3 lates = 1 absence -> +1 penalty) = 3 effective out of 7 max -> 4 left (ok)
    const ok = computeAttendanceStatus({ absences: 2, lates: 4, maxAbsences: 7, latesPerAbsence: 3 });
    expect(ok.latePenalty).toBe(1);
    expect(ok.effectiveAbsences).toBe(3);
    expect(ok.remaining).toBe(4);
    expect(ok.riskLevel).toBe('ok');

    // 5 absences + 3 lates = 6 effective out of 7 max -> 1 left (warn)
    const warn = computeAttendanceStatus({ absences: 5, lates: 3, maxAbsences: 7, latesPerAbsence: 3 });
    expect(warn.effectiveAbsences).toBe(6);
    expect(warn.remaining).toBe(1);
    expect(warn.riskLevel).toBe('warn');

    // Lates conversion turned OFF (latesPerAbsence = 0)
    const noLatePenalty = computeAttendanceStatus({ absences: 3, lates: 9, maxAbsences: 3, latesPerAbsence: 0 });
    expect(noLatePenalty.latePenalty).toBe(0);
    expect(noLatePenalty.effectiveAbsences).toBe(3);
    expect(noLatePenalty.riskLevel).toBe('danger');
  });
});

describe('Native Android TTS Bridge (Study Commute Audio on Android APK)', () => {
  it('uses window.BaiNativeTts when Web Speech API is absent in Android WebView', () => {
    const calls = [];
    const origWindow = globalThis.window;
    globalThis.window = {
      BaiNativeTts: {
        isAvailable: () => true,
        speak: (txt, rate, pitch, id) => calls.push({ txt, rate, pitch, id }),
        stop: () => calls.push({ stopped: true }),
      },
    };
    try {
      expect(isSpeechSupported()).toBe(true);
      let doneFired = false;
      speakSegment({
        text: '**Hello** $x^2$',
        rate: 1.25,
        speaker: 'Tutor',
        onEnd: () => {
          doneFired = true;
        },
      });
      const spoken = calls.find(c => c.txt);
      expect(spoken.txt).toContain('Hello');
      expect(spoken.txt).toContain('squared');
      expect(spoken.rate).toBe(1.25);
      expect(spoken.pitch).toBe(0.9);
      globalThis.window.__baiTtsCallback(spoken.id, 'done');
      expect(doneFired).toBe(true);
      stopSpeech();
      expect(calls.some(c => c.stopped)).toBe(true);
    } finally {
      globalThis.window = origWindow;
    }
  });
});
