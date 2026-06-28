export function structuralSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  options: { dynamicRange?: number } = {},
): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error("SSIM inputs must have the same non-zero length");
  }
  const range = options.dynamicRange ?? 255;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i++) {
    meanA += a[i]!;
    meanB += b[i]!;
  }
  meanA /= a.length;
  meanB /= b.length;
  let varianceA = 0;
  let varianceB = 0;
  let covariance = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    varianceA += da * da;
    varianceB += db * db;
    covariance += da * db;
  }
  const denominator = Math.max(1, a.length - 1);
  varianceA /= denominator;
  varianceB /= denominator;
  covariance /= denominator;
  const c1 = (0.01 * range) ** 2;
  const c2 = (0.03 * range) ** 2;
  return (
    ((2 * meanA * meanB + c1) * (2 * covariance + c2)) /
    ((meanA ** 2 + meanB ** 2 + c1) * (varianceA + varianceB + c2))
  );
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error("percentile requires values");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}
