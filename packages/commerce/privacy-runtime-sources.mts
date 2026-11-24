import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PRIVACY_SOURCE_EXTENSIONS = Object.freeze(['.cjs','.html','.js','.jsx','.mjs','.mts','.py','.ts','.tsx']);
const NON_SOURCE_DIRECTORIES = new Set(['node_modules', '.medusa', '.cache']);

/** Literal source paths only. A bracketed route identifier is never a glob. */
export function privacyRuntimeSourcePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length > 1 && ['apps', 'packages'].includes(parts[0]) && parts.slice(1).every(part =>
    part !== '.' && part !== '..' && (/^[A-Za-z0-9_.-]+$/.test(part) || /^\[[A-Za-z_][A-Za-z0-9_]*\]$/.test(part)));
}

/** Observe first-party executable/HTML source, not installed dependencies or
 * generated outputs. Those require separate input/runtime and privacy audits.
 * Ordinary added source remains a review trigger; this grants no qualification. */
export function observePrivacyRuntimeSources(): {path: string; sha256: string}[] {
  const sources: {path: string; sha256: string}[] = []; let totalBytes = 0, visited = 0;
  function walk(directory: string) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PRIVACY_RUNTIME_SOURCE_UNSAFE');
    for (const name of readdirSync(directory).sort()) {
      if (++visited > 10000) throw new Error('PRIVACY_RUNTIME_SOURCE_LIMIT');
      const path = join(directory, name), entry = lstatSync(path);
      if (entry.isSymbolicLink()) throw new Error('PRIVACY_RUNTIME_SOURCE_UNSAFE');
      if (entry.isDirectory()) {
        if (!NON_SOURCE_DIRECTORIES.has(name)) walk(path);
        continue;
      }
      if (!PRIVACY_SOURCE_EXTENSIONS.includes(extname(name))) continue;
      const rel = relative(ROOT, path).split('\\').join('/');
      if (!entry.isFile() || !privacyRuntimeSourcePath(rel) || entry.size > 2*1024*1024 || sources.length >= 2000 || (totalBytes += entry.size) > 32*1024*1024)
        throw new Error('PRIVACY_RUNTIME_SOURCE_LIMIT');
      sources.push({path: rel, sha256: createHash('sha256').update(readFileSync(path)).digest('hex')});
    }
  }
  for (const directory of ['apps', 'packages']) walk(join(ROOT, directory));
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}
