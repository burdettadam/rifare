import { lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Own only generated ESM files. Validate before creating or overwriting them. */
export function authorityOutput(application, output) {
  application = resolve(application); output = resolve(output);
  const beneath = (root, path) => {
    const name = relative(root, path);
    if (isAbsolute(name) || name === '..' || name.startsWith('..' + sep) || resolve(root, name) !== path)
      throw new Error('Unsafe authority build path');
  };
  beneath(application, output);
  const stat = path => lstatSync(path, { throwIfNoEntry: false });
  function chain(directory, create = false) {
    beneath(application, directory);
    const parts = relative(application, directory).split(sep).filter(Boolean);
    let current = application;
    for (const part of ['', ...parts]) {
      if (part) current = resolve(current, part);
      const entry = stat(current);
      if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) throw new Error('Linked or invalid authority build directory');
      if (!entry && create) mkdirSync(current);
    }
  }
  function files(directory, found = []) {
    const entry = stat(directory);
    if (!entry) return found;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Linked authority build directory');
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name); beneath(output, path);
      const item = stat(path);
      if (item?.isSymbolicLink()) throw new Error('Linked authority build file');
      if (item?.isDirectory()) files(path, found);
      else {
        if (!item?.isFile() || item.nlink !== 1 || !name.endsWith('.mjs')) throw new Error('Unexpected or multiply linked authority build file');
        found.push(path);
      }
    }
    return found;
  }
  chain(output); files(output); // No mkdir/write occurs before this preflight.
  return {
    write(path, contents) {
      path = resolve(path); beneath(output, path); chain(dirname(path), true);
      const entry = stat(path);
      if (entry && (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1)) throw new Error('Linked authority write target');
      writeFileSync(path, contents, { encoding: 'utf8', flag: entry ? 'w' : 'wx' });
    },
    prune(expected) {
      chain(output);
      const stale = files(output).filter(path => !expected.has(path));
      for (const path of stale) unlinkSync(path);
    },
  };
}
