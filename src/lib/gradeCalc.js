/**
 * gradeCalc — Philippine GWA (1.00–5.00), US GPA (4.00) & Target Final-Grade Calculator.
 */

export function percentToPhGwa(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return 5.0;
  if (p >= 96) return 1.0;
  if (p >= 93) return 1.25;
  if (p >= 90) return 1.5;
  if (p >= 87) return 1.75;
  if (p >= 84) return 2.0;
  if (p >= 81) return 2.25;
  if (p >= 78) return 2.5;
  if (p >= 75) return 2.75;
  if (p >= 70) return 3.0;
  return 5.0;
}

export function percentToUsGpa(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return 0.0;
  if (p >= 93) return 4.0;
  if (p >= 90) return 3.7;
  if (p >= 87) return 3.3;
  if (p >= 83) return 3.0;
  if (p >= 80) return 2.7;
  if (p >= 77) return 2.3;
  if (p >= 73) return 2.0;
  if (p >= 70) return 1.7;
  if (p >= 67) return 1.3;
  if (p >= 65) return 1.0;
  return 0.0;
}

/**
 * Compute current weighted standing and exact score needed on the remaining
 * weight (e.g. Final Exam) to hit `targetPercent`.
 */
export function computeTargetFinal({ components = [], targetPercent = 90 }) {
  let earnedWeighted = 0;
  let completedWeight = 0;

  for (const c of components) {
    const w = Math.max(0, Number(c.weight) || 0);
    const score = Number(c.score);
    if (w > 0 && c.score !== '' && Number.isFinite(score)) {
      completedWeight += w;
      earnedWeighted += (score * w) / 100;
    }
  }

  const remainingWeight = Math.max(0, 100 - completedWeight);
  const currentStanding = completedWeight > 0 ? (earnedWeighted / completedWeight) * 100 : 0;
  const requiredOnRemaining =
    remainingWeight > 0 ? ((Number(targetPercent) - earnedWeighted) / remainingWeight) * 100 : null;

  return {
    completedWeight: Math.round(completedWeight * 10) / 10,
    remainingWeight: Math.round(remainingWeight * 10) / 10,
    earnedWeighted: Math.round(earnedWeighted * 100) / 100,
    currentStanding: Math.round(currentStanding * 10) / 10,
    requiredOnRemaining:
      requiredOnRemaining !== null ? Math.round(requiredOnRemaining * 10) / 10 : null,
    phGwa: percentToPhGwa(currentStanding),
    usGpa: percentToUsGpa(currentStanding),
  };
}

/**
 * Compute minimum passing raw score & allowed mistakes for Zero-Based (0), Base-50, or Base-60 grading.
 * Formula: grade = base + (100 - base) * (score / total)
 */
export function computeMinPassingScore({ total, passingPercent = 75, base = 0 } = {}) {
  const tot = Math.max(0, Number(total) || 0);
  const passPct = Math.max(1, Math.min(100, Number(passingPercent) || 75));
  const cleanBase = base === 50 || base === 60 ? base : 0;
  if (tot <= 0) {
    return {
      total: 0,
      passingPercent: passPct,
      base: cleanBase,
      minScore: 0,
      maxMistakes: 0,
      rawPercentRequired: 0,
    };
  }
  const denom = 100 - cleanBase;
  const fractionNeeded = Math.max(0, Math.min(1, (passPct - cleanBase) / denom));
  const minScore = Math.min(tot, Math.max(0, Math.ceil(fractionNeeded * tot - 1e-9)));
  const maxMistakes = Math.max(0, Math.floor(tot - minScore));
  const rawPercentRequired = Math.round((minScore / tot) * 1000) / 10;

  return {
    total: tot,
    passingPercent: passPct,
    base: cleanBase,
    minScore,
    maxMistakes,
    rawPercentRequired,
  };
}

/**
 * Evaluate a quiz/exam score against customizable passing % and grading base (0, 50, or 60).
 */
export function evaluateQuizScore({ score, total, passingPercent = 75, base = 0 } = {}) {
  const tot = Math.max(0, Number(total) || 0);
  const passPct = Math.max(1, Math.min(100, Number(passingPercent) || 75));
  const cleanBase = base === 50 || base === 60 ? base : 0;
  const req = computeMinPassingScore({ total: tot, passingPercent: passPct, base: cleanBase });

  const hasScore = score !== '' && score !== null && score !== undefined && Number.isFinite(Number(score));
  if (tot <= 0 || !hasScore) {
    return {
      ...req,
      hasScore: false,
      score: 0,
      rawPercent: 0,
      transmutedPercent: 0,
      passed: null,
      pointsMargin: 0,
      percentMargin: 0,
    };
  }

  const sc = Math.max(0, Math.min(tot, Number(score)));
  const ratio = sc / tot;
  const rawPercent = Math.round(ratio * 1000) / 10;
  const transmutedPercent = Math.round((cleanBase + (100 - cleanBase) * ratio) * 10) / 10;
  const passed = transmutedPercent >= passPct;
  const pointsMargin = Math.round((sc - req.minScore) * 10) / 10;
  const percentMargin = Math.round((transmutedPercent - passPct) * 10) / 10;

  return {
    ...req,
    hasScore: true,
    score: sc,
    rawPercent,
    transmutedPercent,
    passed,
    pointsMargin,
    percentMargin,
  };
}

/** Summarize saved quiz history (pass rate, average %, and next-quiz score needed to hold passing). */
export function summarizeQuizHistory(records = [], passingPercent = 75) {
  const passPct = Math.max(1, Math.min(100, Number(passingPercent) || 75));
  const valid = (Array.isArray(records) ? records : []).filter(
    r => r && Number.isFinite(Number(r.transmutedPercent ?? r.percent))
  );
  if (valid.length === 0) {
    return { count: 0, passedCount: 0, failedCount: 0, passRate: 0, avgPercent: 0, neededNextPercent: passPct };
  }
  let passedCount = 0;
  let sum = 0;
  for (const r of valid) {
    const pct = Number(r.transmutedPercent ?? r.percent);
    sum += pct;
    if (typeof r.passed === 'boolean' ? r.passed : pct >= passPct) passedCount += 1;
  }
  const count = valid.length;
  const avgPercent = Math.round((sum / count) * 10) / 10;
  const passRate = Math.round((passedCount / count) * 100);
  const neededRaw = passPct * (count + 1) - sum;
  const neededNextPercent = Math.round(Math.max(0, neededRaw) * 10) / 10;

  return {
    count,
    passedCount,
    failedCount: count - passedCount,
    passRate,
    avgPercent,
    neededNextPercent,
  };
}
