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
