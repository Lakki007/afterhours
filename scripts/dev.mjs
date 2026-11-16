// Runs the API server (tsx watch) and the Vite dev server side by side.
// Vite proxies /api to the server, so open the Vite URL it prints.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

const procs = [
  { name: 'server', color: '\x1b[35m', args: ['run', 'dev', '-w', 'server'] },
  { name: 'web   ', color: '\x1b[36m', args: ['run', 'dev', '-w', 'web'] },
].map(({ name, color, args }) => {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: isWin, env: process.env });
  const prefix = `${color}${name}\x1b[0m │ `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    if (p.exitCode === null) {
      if (isWin) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      else p.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
