import { Transaction } from '@/types/transaction';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('el-GR', { 
    style: 'currency', 
    currency: 'EUR' 
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date(dateStr));
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 90) return 'bg-primary';
  if (confidence >= 70) return 'bg-brand-blue';
  if (confidence >= 50) return 'bg-status-warn';
  return 'bg-status-error';
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'matched':
    case 'approved':
      return 'status-matched';
    case 'pending':
      return 'status-pending';
    case 'rejected':
      return 'status-rejected';
    case 'unmatched':
    default:
      return 'status-unmatched';
  }
}

export function exportToCSV(transactions: Transaction[], filename?: string) {
  const headers = ['ID', 'Date', 'Bank Description', 'GL Description', 'Amount', 'Confidence', 'Match Type', 'Status', 'Flags'];

  const rows = transactions.map(tx => [
    tx.id,
    tx.date,
    `"${(tx.bank_desc || '').replace(/"/g, '""')}"`,
    `"${(tx.gl_desc || '').replace(/"/g, '""')}"`,
    tx.amount.toFixed(2),
    tx.confidence.toString(),
    tx.match_type,
    tx.status,
    `"${(tx.flags || []).join('; ')}"`
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  const date = new Date().toISOString().split('T')[0];
  link.setAttribute('href', url);
  link.setAttribute('download', filename || `Recon_Export_${date}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Levenshtein distance for string similarity
export function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => 
    Array(a.length + 1).fill(null)
  );
  
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  
  return matrix[b.length][a.length];
}

export function calculateConfidence(amount1: number, amount2: number, desc1: string, desc2: string): number {
  let confidence = 0;
  
  // Amount matching (70 points max)
  if (Math.abs(amount1 - amount2) < 0.01) {
    confidence += 70;
  } else {
    const amountDiff = Math.abs(amount1 - amount2) / Math.max(amount1, amount2, 1);
    confidence += Math.max(0, 70 * (1 - amountDiff));
  }
  
  // Description similarity (30 points max)
  const maxLen = Math.max(desc1.length, desc2.length);
  if (maxLen > 0) {
    const distance = levenshteinDistance(
      desc1.toLowerCase(), 
      desc2.toLowerCase()
    );
    const similarity = 1 - (distance / maxLen);
    confidence += similarity * 30;
  }
  
  return Math.round(confidence);
}
