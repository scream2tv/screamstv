import { existsSync, mkdirSync, symlinkSync, lstatSync, unlinkSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const target = resolve(root, 'node_modules', 'midnight-agent');
const source = resolve(root, '..', '..', '..', 'agent-lump', 'midnight-agent');

if (!existsSync(source)) {
  console.error(`midnight-agent not found at ${source}`);
  console.error('Clone/build it first: see README.md');
  process.exit(1);
}

if (!existsSync(resolve(source, 'dist', 'index.js'))) {
  console.error(`midnight-agent not built — run: cd ${source} && npm run build`);
  process.exit(1);
}

// Selective link: only expose dist + package.json (not node_modules)
if (existsSync(target)) {
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      unlinkSync(target);
    } else if (stat.isDirectory()) {
      const contents = readdirSync(target);
      if (contents.includes('dist') && contents.includes('package.json') && !contents.includes('node_modules')) {
        process.exit(0);
      }
    }
  } catch {}
}

if (!existsSync(target)) {
  mkdirSync(target, { recursive: true });
}

const distLink = resolve(target, 'dist');
const pkgLink = resolve(target, 'package.json');

if (!existsSync(distLink)) {
  symlinkSync(resolve(source, 'dist'), distLink);
}
if (!existsSync(pkgLink)) {
  symlinkSync(resolve(source, 'package.json'), pkgLink);
}

console.log(`Linked midnight-agent (dist + package.json) → ${source}`);
