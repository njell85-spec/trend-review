import { appendFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[36m',
  info:  '\x1b[32m',
  warn:  '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  bold:  '\x1b[1m',
};

export class Logger {
  constructor(name, options = {}) {
    this.name = name;
    this.level = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;
    this.logDir = options.logDir ?? path.join(process.cwd(), 'output', 'logs');
    this.logFile = options.logFile ?? null;
    this.entries = [];
  }

  _format(level, message, meta) {
    const ts = new Date().toISOString();
    const entry = { ts, level, agent: this.name, message, ...(meta && { meta }) };
    this.entries.push(entry);
    return entry;
  }

  _print(level, entry) {
    if (LEVELS[level] < this.level) return;
    const c = COLORS[level];
    const ts = `${COLORS.dim}${entry.ts}${COLORS.reset}`;
    const tag = `${c}${COLORS.bold}[${level.toUpperCase()}]${COLORS.reset}`;
    const agent = `${COLORS.dim}[${this.name}]${COLORS.reset}`;
    const msg = level === 'error' ? `${COLORS.bold}${entry.message}${COLORS.reset}` : entry.message;
    console.log(`${ts} ${tag} ${agent} ${msg}`);
    if (entry.meta) {
      console.log(`       ${COLORS.dim}${JSON.stringify(entry.meta)}${COLORS.reset}`);
    }
  }

  async _persist(entry) {
    if (!this.logFile) return;
    try {
      if (!existsSync(this.logDir)) await mkdir(this.logDir, { recursive: true });
      await appendFile(
        path.join(this.logDir, this.logFile),
        JSON.stringify(entry) + '\n'
      );
    } catch { /* non-fatal */ }
  }

  _log(level, message, meta) {
    const entry = this._format(level, message, meta);
    this._print(level, entry);
    this._persist(entry);
    return entry;
  }

  debug(msg, meta) { return this._log('debug', msg, meta); }
  info(msg, meta)  { return this._log('info',  msg, meta); }
  warn(msg, meta)  { return this._log('warn',  msg, meta); }
  error(msg, meta) { return this._log('error', msg, meta); }

  section(title) {
    const line = '─'.repeat(60);
    console.log(`\n${COLORS.bold}${line}${COLORS.reset}`);
    console.log(`${COLORS.bold}  ${title}${COLORS.reset}`);
    console.log(`${COLORS.bold}${line}${COLORS.reset}\n`);
  }

  getEntries() { return [...this.entries]; }

  async saveSession(sessionId) {
    const sessionPath = path.join(this.logDir, `session_${sessionId}.jsonl`);
    try {
      if (!existsSync(this.logDir)) await mkdir(this.logDir, { recursive: true });
      // 한 번에 덮어쓰기 — 같은 세션 ID로 재저장(재개 등) 시 항목 중복 방지
      const body = this.entries.map((e) => JSON.stringify(e)).join('\n');
      await writeFile(sessionPath, body ? body + '\n' : '');
      return sessionPath;
    } catch (err) {
      this.error('Failed to save session log', { err: err.message });
      return null;
    }
  }
}
