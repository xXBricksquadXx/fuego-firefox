import { rmSync } from 'node:fs';

const OUTDIR = '.demo-out';

rmSync(OUTDIR, { recursive: true, force: true });
console.log(`Cleaned: ${OUTDIR}`);
