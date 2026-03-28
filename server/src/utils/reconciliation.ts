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

// ============================================================
// Pattern extraction for learned matching rules
// ============================================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'for', 'to', 'from', 'of', 'in', 'on', 'at', 'by',
  'and', 'or', 'is', 'was', 'are', 'be', 'has', 'had', 'do', 'did',
  'this', 'that', 'with', 'as', 'but', 'not', 'no', 'so', 'if',
  'eur', 'usd', 'gbp', 'ltd', 'co',
]);

/**
 * Extract a meaningful pattern from a transaction description.
 * Strips dates, pure numbers, amounts, and stop words.
 * Keeps vendor names, invoice refs, account identifiers.
 */
export function extractPattern(description: string): string {
  if (!description) return '';
  let text = description.toLowerCase();

  // Remove date patterns (DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY)
  text = text.replace(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g, '');
  text = text.replace(/\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/g, '');

  // Remove monetary amounts (€1,234.56 or 1.234,56 patterns)
  text = text.replace(/[€$£]?\s*\d{1,3}([.,]\d{3})*([.,]\d{2})?\b/g, '');

  // Remove standalone numbers (references kept if part of a word like INV.2091)
  text = text.replace(/\b\d+\b/g, '');

  // Remove extra whitespace and special chars (keep dots in abbreviations)
  text = text.replace(/[><\-\/\\|]+/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  // Split, remove stop words and very short tokens
  const tokens = text.split(/\s+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));

  return tokens.join(' ');
}

/**
 * Check if a description matches a learned pattern.
 * Returns true if all pattern tokens appear in the description.
 */
export function matchesPattern(description: string, pattern: string): boolean {
  if (!pattern || !description) return false;
  const descLower = description.toLowerCase();
  const patternTokens = pattern.split(/\s+/).filter(t => t.length > 1);
  if (patternTokens.length === 0) return false;

  // All pattern tokens must appear somewhere in the description
  return patternTokens.every(token => descLower.includes(token));
}
