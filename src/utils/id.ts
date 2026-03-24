export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
  }
  // Fallback for non-secure contexts (HTTP)
  const hex = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${prefix}-${hex}`;
}
