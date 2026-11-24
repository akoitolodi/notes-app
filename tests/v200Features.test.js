import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  solvePercentageLine,
  solveUnitOrBase,
  solveAlgebraEquation,
  solveArithmeticLine,
  solveVariableScratchpad,
  parseChemicalFormula,
  solveChemistryText,
  solvePhysicsText,
  solveNumberStats,
  solveSubnetCidr,
  detectColorToken,
  detectBestMathSolution,
} from '../src/lib/mathSolver';
import {
  detectRawCode,
  detectErrorTrace,
  detectNoteDeadline,
  detectStudyTerms,
  detectTranslateIntent,
  detectGoogleDocLink,
  detectBlankNoteIntents,
} from '../src/lib/smartNoteDetect';
import { runJavaScriptLocally } from '../src/lib/codeRunner';
import { detectDateInText, parseRssAnnouncements } from '../src/lib/canvasSync';
import {
  NOTE_TEMPLATES,
  INSERT_BLOCKS,
  instantiateTemplate,
  getInsertBlockSnippet,
} from '../src/lib/templates';
import {
  db,
  saveCustomTemplate,
  listCustomTemplates,
  deleteCustomTemplate,
  togglePinPlannerItem,
} from '../src/store/db';

describe('v2.0.0 Offline Math, Science, Stats & IT Solvers', () => {
  it('solves arithmetic & scientific expressions without eval and ignores dates', () => {
    expect(solveArithmeticLine('25 * 14 + 8')?.answer).toBe('358');
    expect(solveArithmeticLine('sqrt(144) + 2^5 =')?.answer).toBe('44');
    expect(solveArithmeticLine('sin(pi / 2)')?.answer).toBe('1');
    expect(solveArithmeticLine('2026-11-24')).toBeNull();
    expect(solveArithmeticLine('42')).toBeNull();
  });

  it('solves percentages & score ratios', () => {
    expect(solvePercentageLine('25% of 480')?.answer).toBe('120');
    expect(solvePercentageLine('42 / 50 as %')?.answer).toBe('84%');
    expect(solvePercentageLine('500 - 20%')?.answer).toBe('400');
  });

  it('solves linear, quadratic, and complex 1-variable equations', () => {
    expect(solveAlgebraEquation('2x + 5 = 17')?.answer).toBe('x = 6');
    expect(solveAlgebraEquation('3(n - 2) = 15')?.answer).toBe('n = 7');
    expect(solveAlgebraEquation('x^2 - 5x + 6 = 0')?.answer).toBe('x = 2, x = 3');
    expect(solveAlgebraEquation('x^2 + 4 = 0')?.answer).toContain('± 2i');
  });

  it('evaluates multi-line variable scratchpads', () => {
    const res = solveVariableScratchpad(['quiz = 45', 'exam = 88', 'quiz * 0.3 + exam * 0.7']);
    expect(res?.answer).toBe('75.1');
  });

  it('converts units and IT number bases offline', () => {
    expect(solveUnitOrBase('37 C to F')?.answer).toBe('98.6 °F');
    expect(solveUnitOrBase('2048 MB to GB')?.answer).toBe('2 GB');
    expect(solveUnitOrBase('255 to hex')?.answer).toBe('0xFF');
    expect(solveUnitOrBase('0b10110 to dec')?.answer).toBe('22');
  });

  it('calculates chemistry molar masses and avoids English false positives', () => {
    expect(parseChemicalFormula('H2O')?.molarMass).toBeCloseTo(18.015, 2);
    expect(parseChemicalFormula('H2SO4')?.molarMass).toBeCloseTo(98.072, 1);
    expect(parseChemicalFormula('Ca(OH)2')?.molarMass).toBeCloseTo(74.092, 1);
    expect(parseChemicalFormula('In')).toBeNull();
    expect(parseChemicalFormula('Canvas')).toBeNull();
    expect(parseChemicalFormula('AI')).toBeNull();
    expect(solveChemistryText('H2 + O2 -> H2O')?.kind).toBe('reaction');
  });

  it('solves physics givens offline (Force, Ohm Law, Kinetic Energy)', () => {
    expect(solvePhysicsText('m = 5 kg\na = 3 m/s^2')?.answer).toContain('15 N');
    expect(solvePhysicsText('V = 12 V, R = 4 ohm')?.answer).toContain('3 A');
    expect(solvePhysicsText('m = 2 kg, v = 10 m/s')?.answer).toContain('100 J');
  });

  it('computes offline statistics, IPv4 subnets, and color tokens', () => {
    const st = solveNumberStats('scores: 85, 90, 78, 92, 88');
    expect(st?.count).toBe(5);
    expect(st?.mean).toBeCloseTo(86.6, 2);
    expect(st?.median).toBe(88);

    const sub = solveSubnetCidr('Router subnet 192.168.1.0/24');
    expect(sub?.mask).toBe('255.255.255.0');
    expect(sub?.broadcast).toBe('192.168.1.255');
    expect(sub?.usableHosts).toBe(254);

    const col = detectColorToken('Primary color #0a84ff');
    expect(col?.rgb).toBe('rgb(10, 132, 255)');
  });

  it('picks the best math solution from the most recently typed note lines', () => {
    const res = detectBestMathSolution('Lecture notes\n\n2x + 5 = 17');
    expect(res?.answer).toBe('x = 6');
  });
});

describe('v2.0.0 Smart Blank-Note Auto-Detection & Loop-Safe JS Runner', () => {
  it('recognizes raw unfenced code across multiple languages without backticks', () => {
    expect(detectRawCode('console.log(5 * 8)')?.langId).toBe('javascript');
    expect(detectRawCode('def greet(name):\n    print(name)')?.langId).toBe('python');
    expect(detectRawCode('#include <iostream>\ncout << "Hello";')?.langId).toBe('cpp');
    expect(detectRawCode('System.out.println("Hello");')?.langId).toBe('java');
    expect(detectRawCode('SELECT name FROM students WHERE grade >= 90;')?.langId).toBe('sql');
    expect(detectRawCode('<div><h1>Hello</h1></div>')?.langId).toBe('html');
  });

  it('executes JavaScript offline and stops accidental infinite loops safely', () => {
    const ok = runJavaScriptLocally('console.log(6 * 7);');
    expect(ok.ok).toBe(true);
    expect(ok.stdout).toBe('42');

    const loop = runJavaScriptLocally('while (true) { let x = 1; }');
    expect(loop.ok).toBe(false);
    expect(loop.stderr).toMatch(/Infinite loop stopped/i);
  });

  it('detects errors, deadlines, offline flashcards, Google Docs, and Filipino/Bisaya text', () => {
    expect(detectErrorTrace('TypeError: Cannot read properties of undefined')).not.toBeNull();
    expect(detectNoteDeadline('Submit lab report on Nov 28')?.dateKey).toMatch(/-11-28$/);

    const terms = detectStudyTerms(
      'Router: Forwards packets across networks\nSwitch: Connects devices within a LAN\nDNS: Resolves domain names to IP addresses'
    );
    expect(terms?.count).toBe(3);

    expect(
      detectGoogleDocLink('Slides: https://docs.google.com/presentation/d/abc123XYZ/edit')?.kind
    ).toBe('Google Slides');

    expect(
      detectTranslateIntent('Hindi ko pa tapos yung assignment kasi mahirap ang tanong.')?.targetLang
    ).toBe('English');
    expect(
      detectTranslateIntent('translate to filipino: Good morning class')?.targetLang
    ).toBe('Filipino');
  });

  it('strictly disables all detection inside Zero-AI Vault notes and avoids prose false positives', () => {
    expect(detectBlankNoteIntents('console.log(123)', { isZeroAi: true })).toEqual([]);
    expect(detectBlankNoteIntents('2x + 5 = 17', { enabled: false })).toEqual([]);
    expect(
      detectBlankNoteIntents('Today I attended class and reviewed our upcoming project topics.')
    ).toEqual([]);
  });
});

describe('v2.0.0 Announcements Date Detection, Pinning & Redesigned Templates', () => {
  beforeEach(async () => {
    await db.customTemplates.clear();
    await db.plannerItems.clear();
  });

  it('extracts mentioned dates inside Canvas Atom announcements & preserves pinned state', async () => {
    const ref = new Date(2026, 10, 24, 12, 0, 0); // Nov 24, 2026
    expect(detectDateInText('Quiz moved to Dec 5', ref)).toBe('2026-12-05');
    expect(detectDateInText('Bring calculator tomorrow', ref)).toBe('2026-11-25');

    const xml = `<?xml version="1.0"?><feed><title>IPT 101 Announcements Feed</title><entry><id>ann-1</id><title>Quiz Schedule</title><content type="html">&lt;p&gt;Quiz will be on Dec 2.&lt;/p&gt;</content><published>2026-11-24T08:00:00Z</published></entry></feed>`;
    const parsed = parseRssAnnouncements(xml);
    expect(parsed[0].detectedDateKey).toMatch(/-12-02$/);

    const id = await db.plannerItems.add({
      title: 'Google Chat Link',
      type: 'announcement',
      course: 'IPT 101',
      dateKey: '2026-11-24',
      pinned: false,
    });
    expect(await togglePinPlannerItem(id)).toBe(true);
    expect((await db.plannerItems.get(id)).pinned).toBe(true);
  });

  it('supports clean built-in templates, legacy aliases, insert blocks, and custom templates CRUD', async () => {
    expect(NOTE_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(INSERT_BLOCKS.length).toBeGreaterThanOrEqual(8);
    expect(instantiateTemplate('class_note').body).toContain('## Topic');
    expect(instantiateTemplate('lecture').body).toContain('## Topic'); // legacy alias
    expect(getInsertBlockSnippet('code_py')).toContain('print(');

    const saved = await saveCustomTemplate({
      name: 'My Review Sheet',
      title: 'Review — ',
      body: '## Key Points\n- ',
    });
    const list = await listCustomTemplates();
    expect(list.some(t => t.id === saved.id && t.name === 'My Review Sheet')).toBe(true);
    await deleteCustomTemplate(saved.id);
    expect((await listCustomTemplates()).length).toBe(0);
  });
});
