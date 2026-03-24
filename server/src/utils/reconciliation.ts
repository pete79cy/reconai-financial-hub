// Levenshtein distance for string similarity
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Calculate confidence score (0-100) between two transactions
export function calculateConfidence(
  amount1: number,
  amount2: number,
  desc1: string,
  desc2: string
): number {
  // Amount matching (70 points max)
  let amountScore = 0;
  const amountDiff = Math.abs(amount1 - amount2);
  const maxAmount = Math.max(amount1, amount2, 1);
  const percentDiff = amountDiff / maxAmount;

  if (amountDiff < 0.01) {
    amountScore = 70;
  } else {
    amountScore = Math.max(0, 70 * (1 - percentDiff));
  }

  // Description similarity (30 points max)
  let descScore = 0;
  const d1 = desc1.toLowerCase().trim();
  const d2 = desc2.toLowerCase().trim();

  if (d1 && d2) {
    const distance = levenshteinDistance(d1, d2);
    const maxLen = Math.max(d1.length, d2.length, 1);
    const similarity = 1 - distance / maxLen;
    descScore = similarity * 30;
  }

  return Math.round(amountScore + descScore);
}

// Constants
export const CONFIDENCE_AUTO_MATCH_MIN = 50;
export const CONFIDENCE_HIGH = 90;
export const CONFIDENCE_MEDIUM = 80;
export const HIGH_VALUE_THRESHOLD = 10000;
