// Word pools per level (A-Z only). Tech and club flavoured. Lengths must fit LADDER.
import { LADDER, normaliseWord } from '@afterhours/shared/features/morse';

export const WORDS: Record<number, string[]> = {
  1: ['hi', 'bug', 'git', 'ssh', 'cpu', 'ram', 'web', 'npm', 'css', 'vim', 'app', 'bit', 'key', 'ram', 'sql', 'api', 'ide', 'tab', 'run', 'fix', 'dev', 'png', 'pdf', 'gif', 'tea'],
  2: ['code', 'byte', 'ping', 'node', 'java', 'wifi', 'hack', 'tmux', 'grep', 'bash', 'rust', 'dart', 'loop', 'sudo', 'exit', 'null', 'kmit', 'chai', 'demo', 'repo', 'fork', 'push', 'pull', 'port', 'void'],
  3: ['debug', 'linux', 'stack', 'array', 'cloud', 'merge', 'regex', 'admin', 'pixel', 'token', 'cache', 'async', 'macro', 'patch', 'shell', 'swift', 'agile', 'login', 'proxy', 'query', 'class', 'chess', 'pizza', 'ready', 'build'],
  4: ['commit', 'python', 'docker', 'kernel', 'server', 'branch', 'syntax', 'signal', 'cipher', 'socket', 'buffer', 'script', 'client', 'router', 'github', 'coffee', 'laptop', 'binary', 'thread', 'module', 'hunter', 'secret'],
  5: ['recurse', 'hackers', 'compile', 'network', 'backend', 'deploy', 'machine', 'frontend', 'protocol', 'firewall', 'terminal', 'hardware', 'keyboard', 'morsecode', 'algorithm', 'database', 'function', 'variable', 'platform', 'telegram'].filter((w) => w.length >= 7),
};

/** Fails loudly at import time if a pool breaks the ladder (so a typo is caught by the first test run). */
export function validateWords(): void {
  for (const def of LADDER) {
    const pool = WORDS[def.level];
    if (!pool || pool.length < 12) throw new Error(`Level ${def.level} needs at least 12 words`);
    for (const w of pool) {
      if (w !== normaliseWord(w).toLowerCase()) throw new Error(`Bad word "${w}"`);
      if (w.length < def.minLen || w.length > def.maxLen) throw new Error(`"${w}" does not fit level ${def.level}`);
    }
  }
}
validateWords();
