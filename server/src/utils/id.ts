import { randomBytes } from 'crypto';

export function generateId(prefix: string): string {
  const hex = randomBytes(6).toString('hex');
  return `${prefix}-${hex}`;
}
