import { createHash } from 'node:crypto';

export type Row = Record<string, any>;
export const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(value))
    throw new Error('INVALID_INPUT');
  return value;
}
export function exact(value: unknown, fields: string[]): Row {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...fields].sort().join(',')
  )
    throw new Error('INVALID_INPUT');
  return value as Row;
}
