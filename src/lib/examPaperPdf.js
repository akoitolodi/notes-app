/**
 * Authentic Short Bond Paper (8.5" x 11" Letter) PDF Generator for Exam Papers.
 * Lazy-loaded via dynamic import so jsPDF never bloats the initial bundle.
 *
 * Modes:
 * - 'exam_with_key': Printable blank exam paper + separate Answer Key page
 * - 'exam_only': Printable blank exam paper only
 * - 'answered': Student's filled-in answers & calculated score
 */
import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { ROMAN_NUMERALS, gradeExamPaperOffline } from './examPaper';

function cleanForPdf(str) {
  return String(str || '')
    .replace(/\r/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/•/g, '-')
    .replace(/\u00A0/g, ' ');
}

export function buildExamPaperPDF({
  paper,
  studentInfo = {},
  answers = {},
  writtenScores = {},
  exportMode = 'exam_with_key', // 'exam_with_key' | 'exam_only' | 'answered'
}) {
  // Authentic US Letter / Short Bond Paper (8.5 x 11 in = 215.9 x 279.4 mm)
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 18;
  const maxW = pageW - marginX * 2;
  let y = 18;

  const ensureSpace = needed => {
    if (y + needed > pageH - 18) {
      doc.addPage();
      y = 18;
    }
  };

  const writeWrapped = (text, { x = marginX, width = maxW, size = 10.5, bold = false, italic = false, color = [20, 20, 20], lineH = 5 } = {}) => {
    doc.setFont('helvetica', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(cleanForPdf(text), width);
    for (const ln of lines) {
      ensureSpace(lineH + 1);
      doc.text(ln, x, y);
      y += lineH;
    }
  };

  const showAnswered = exportMode === 'answered';
  const grade = gradeExamPaperOffline(paper, answers, writtenScores);

  // ── Authentic Bond-Paper Exam Header ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 15, 15);
  doc.text(cleanForPdf(paper.title || 'EXAMINATION').toUpperCase(), pageW / 2, y, { align: 'center' });
  y += 6;

  if (paper.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(cleanForPdf(paper.subtitle), pageW / 2, y, { align: 'center' });
    y += 5.5;
  }

  // Name / Section / Date / Score header grid
  y += 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(25, 25, 25);
  const nameVal = studentInfo.name || '____________________________';
  const secVal = studentInfo.section || '_______________';
  const dateVal = studentInfo.date || new Date().toLocaleDateString();
  const scoreVal = showAnswered ? `${grade.totalEarned} / ${grade.totalMax}` : `_____ / ${grade.totalMax}`;

  doc.text(`Name: ${cleanForPdf(nameVal)}`, marginX, y);
  doc.text(`Section: ${cleanForPdf(secVal)}`, pageW - marginX - 52, y);
  y += 6;
  doc.text(`Date: ${cleanForPdf(dateVal)}`, marginX, y);
  doc.setFont('helvetica', 'bold');
  doc.text(`Score: ${scoreVal}`, pageW - marginX - 52, y);
  y += 4;

  // Crisp academic double divider line
  doc.setDrawColor(30, 30, 30);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, pageW - marginX, y);
  doc.setLineWidth(0.2);
  doc.line(marginX, y + 1.2, pageW - marginX, y + 1.2);
  y += 8;

  // ── Render Each Part ──
  (paper.parts || []).forEach((part, pIdx) => {
    const roman = ROMAN_NUMERALS[pIdx] || String(pIdx + 1);
    const partPts = (part.items?.length || 0) * (Number(part.pointsEach) || 1);

    ensureSpace(16);
    writeWrapped(`PART ${roman}. ${String(part.heading || '').toUpperCase()} (${partPts} pts)`, {
      size: 11,
      bold: true,
      lineH: 5.5,
    });
    if (part.directions) {
      writeWrapped(`Directions: ${part.directions}`, {
        size: 9.5,
        italic: true,
        color: [75, 75, 75],
        lineH: 4.5,
      });
    }
    y += 2;

    if (part.type === 'matching') {
      const leftW = maxW * 0.52;
      const rightX = marginX + leftW + 8;
      const rightW = maxW - leftW - 8;
      const maxRows = Math.max(part.items.length, (part.columnB || []).length);

      ensureSpace(8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 30, 30);
      doc.text('Column A', marginX, y);
      doc.text('Column B', rightX, y);
      y += 5;

      for (let r = 0; r < maxRows; r++) {
        const leftItem = part.items[r];
        const rightItem = part.columnB?.[r];
        const key = `${pIdx}-${r}`;
        const ans = showAnswered && answers[key] ? `[${answers[key]}]` : '____';
        const lLines = leftItem
          ? doc.splitTextToSize(cleanForPdf(`${ans} ${r + 1}. ${leftItem.prompt}`), leftW)
          : [];
        const rLines = rightItem
          ? doc.splitTextToSize(cleanForPdf(`${rightItem.letter}. ${rightItem.text}`), rightW)
          : [];
        const rowH = Math.max(lLines.length, rLines.length, 1) * 4.8 + 1.5;
        ensureSpace(rowH);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(20, 20, 20);
        lLines.forEach((ln, li) => doc.text(ln, marginX, y + li * 4.8));
        rLines.forEach((ln, ri) => doc.text(ln, rightX, y + ri * 4.8));
        y += rowH;
      }
      y += 4;
      return;
    }

    (part.items || []).forEach((item, iIdx) => {
      const key = `${pIdx}-${iIdx}`;
      const num = iIdx + 1;
      const userVal = answers[key];

      if (part.type === 'mcq') {
        ensureSpace(16);
        writeWrapped(`${num}. ${item.question}`, { size: 10.5, lineH: 5 });
        (item.choices || []).forEach((ch, ci) => {
          const letter = String.fromCharCode(65 + ci);
          const picked = showAnswered && userVal === ci ? '[X] ' : '    ';
          writeWrapped(`${picked}${letter}. ${ch}`, { x: marginX + 5, width: maxW - 5, size: 10, lineH: 4.8 });
        });
        y += 2;
      } else if (part.type === 'true_false') {
        const blank = showAnswered && typeof userVal === 'boolean' ? (userVal ? '[TRUE] ' : '[FALSE]') : '_______';
        writeWrapped(`${blank}  ${num}. ${item.statement}`, { size: 10.5, lineH: 5.2 });
        y += 1.5;
      } else if (part.type === 'identification') {
        const blank = showAnswered && userVal ? `[ ${userVal} ]` : '_____________________';
        writeWrapped(`${blank}  ${num}. ${item.question}`, { size: 10.5, lineH: 5.2 });
        y += 1.5;
      } else if (part.type === 'enumeration') {
        const count = item.answers?.length || 3;
        ensureSpace(8 + count * 6);
        writeWrapped(`${num}. ${item.question} (${part.pointsEach} pts)`, { size: 10.5, lineH: 5 });
        const userArr = Array.isArray(userVal) ? userVal : [];
        for (let k = 0; k < count; k++) {
          const filled = showAnswered && userArr[k] ? userArr[k] : '__________________________________________________';
          writeWrapped(`   ${String.fromCharCode(97 + k)}. ${filled}`, { size: 10, lineH: 5.5 });
        }
        y += 2;
      } else if (part.type === 'problem_solving' || part.type === 'scenario' || part.type === 'essay') {
        ensureSpace(34);
        if (item.scenario) {
          writeWrapped(`Scenario ${num}: ${item.scenario}`, {
            size: 10,
            italic: true,
            color: [55, 55, 55],
            lineH: 4.8,
          });
          y += 1;
        }
        writeWrapped(`${num}. ${item.question} (${part.pointsEach} pts)`, {
          size: 10.5,
          bold: true,
          lineH: 5,
        });
        y += 1.5;

        if (showAnswered && String(userVal || '').trim()) {
          writeWrapped(String(userVal), {
            x: marginX + 4,
            width: maxW - 8,
            size: 10,
            color: [20, 40, 90],
            lineH: 5,
          });
          y += 4;
        } else if (part.type === 'problem_solving') {
          // Draw authentic solution workspace box
          const boxH = 26;
          ensureSpace(boxH + 4);
          doc.setDrawColor(160, 160, 160);
          doc.setLineWidth(0.3);
          doc.rect(marginX, y, maxW, boxH);
          doc.setFontSize(8);
          doc.setTextColor(150, 150, 150);
          doc.text('Show your solution / trace here:', marginX + 2.5, y + 4.5);
          y += boxH + 5;
        } else {
          // Ruled essay lines
          const linesCount = 5;
          ensureSpace(linesCount * 6.5 + 3);
          doc.setDrawColor(175, 175, 175);
          doc.setLineWidth(0.25);
          for (let l = 0; l < linesCount; l++) {
            y += 6.2;
            doc.line(marginX, y, pageW - marginX, y);
          }
          y += 5;
        }
      }
    });

    y += 4;
  });

  // ── Separate Answer Key Page (Clean Page Break!) ──
  if (exportMode === 'exam_with_key') {
    doc.addPage();
    y = 18;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 15, 15);
    doc.text('ANSWER KEY & SOLUTIONS', pageW / 2, y, { align: 'center' });
    y += 5.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(90, 90, 90);
    doc.text(cleanForPdf(paper.title || ''), pageW / 2, y, { align: 'center' });
    y += 6;
    doc.setDrawColor(40, 40, 40);
    doc.line(marginX, y, pageW - marginX, y);
    y += 7;

    (paper.parts || []).forEach((part, pIdx) => {
      const roman = ROMAN_NUMERALS[pIdx] || String(pIdx + 1);
      ensureSpace(12);
      writeWrapped(`PART ${roman}. ${String(part.heading || '').toUpperCase()}`, {
        size: 10.5,
        bold: true,
        lineH: 5.5,
      });

      (part.items || []).forEach((item, iIdx) => {
        const num = iIdx + 1;
        let line = '';
        if (part.type === 'mcq') {
          const ltr = String.fromCharCode(65 + (item.answerIndex || 0));
          line = `${num}. ${ltr} (${item.choices?.[item.answerIndex] || ''})${item.explanation ? ` — ${item.explanation}` : ''}`;
        } else if (part.type === 'true_false') {
          line = `${num}. ${item.answer ? 'TRUE' : 'FALSE'}${item.explanation ? ` — ${item.explanation}` : ''}`;
        } else if (part.type === 'identification') {
          line = `${num}. ${item.answer}${item.explanation ? ` — ${item.explanation}` : ''}`;
        } else if (part.type === 'matching') {
          line = `${num}. ${item.answerLetter}${item.explanation ? ` — ${item.explanation}` : ''}`;
        } else if (part.type === 'enumeration') {
          line = `${num}. ${(item.answers || []).join('; ')}`;
        } else {
          line = `${num}. ${item.solution || 'See rubric'}`;
        }
        writeWrapped(line, { size: 9.8, lineH: 4.8 });
        if (item.rubric?.length > 0) {
          writeWrapped(`   Key points: ${item.rubric.join(' | ')}`, {
            size: 9,
            italic: true,
            color: [90, 90, 90],
            lineH: 4.4,
          });
        }
      });
      y += 4;
    });
  }

  return doc;
}

export async function saveExamPaperPDF(doc, baseName = 'exam-paper') {
  const safe =
    String(baseName || 'exam-paper')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'exam-paper';
  const filename = `${safe}.pdf`;

  if (Capacitor.isNativePlatform?.()) {
    const dataUri = doc.output('datauristring');
    const b64 = dataUri.split(',')[1];
    const written = await Filesystem.writeFile({
      path: filename,
      data: b64,
      directory: Directory.Cache,
    });
    try {
      await Share.share({
        title: filename,
        files: [written.uri],
        dialogTitle: 'Print or Save Exam Paper PDF',
      });
      return 'shared';
    } catch (err) {
      if (/cancel|abort/i.test(String(err?.message || err))) {
        return 'cancelled';
      }
      throw err;
    }
  }

  doc.save(filename);
  return 'downloaded';
}
