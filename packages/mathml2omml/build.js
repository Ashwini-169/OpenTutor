import fs from 'fs';
import path from 'path';

const src = path.resolve('src', 'index.js');
const outDir = path.resolve('dist');
const dest = path.join(outDir, 'index.js');

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('mathml2omml: built', dest);
