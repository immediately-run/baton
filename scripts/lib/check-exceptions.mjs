/** Baselines are exact, not ceilings: removing a discrepancy also requires removing its row. */
export function exceptionProblems(label, differences, baseline) {
  const actual = new Set(differences);
  return [
    ...[...actual].filter((entry) => !Object.hasOwn(baseline, entry)).sort().map((entry) => `${label}: ${entry}`),
    ...Object.keys(baseline).filter((entry) => !actual.has(entry)).sort().map((entry) => `${label}: remove stale exception ${entry}`),
  ];
}
