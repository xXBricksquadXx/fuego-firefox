import { rmSync, existsSync } from 'node:fs';

const TARGET = '.demo-out';

if (!existsSync(TARGET)) {
  console.log('Nothing to clean: .demo-out does not exist.');
  process.exit(0);
}

rmSync(TARGET, { recursive: true, force: true });
console.log('Cleaned: .demo-out');
