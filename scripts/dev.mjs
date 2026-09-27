import { spawn } from 'node:child_process';
import process from 'node:process';

const commands = [
  [process.execPath, ['--watch', '--import', 'tsx', 'src/server/index.ts']],
  [process.execPath, ['node_modules/vite/bin/vite.js']],
];
const children = commands.map(([command, args]) => spawn(command, args, { stdio: 'inherit' }));
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}

for (const child of children) child.on('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
