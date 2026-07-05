import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkgDir = path.resolve(root, '../transfer/src/wasm/pkg');
const destDir = path.resolve(root, 'public/wasm');

const assets = ['twelve_c_cryptography.wasm', 'twelve_c_cryptography.js'];

mkdirSync(destDir, { recursive: true });
for (const name of assets) {
  const src = path.join(pkgDir, name);
  const dest = path.join(destDir, name);
  copyFileSync(src, dest);
  console.log(`copied ${name} -> ${dest}`);
}
