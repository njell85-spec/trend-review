import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

export class Cache {
  constructor(options = {}) {
    this.dir = options.dir ?? path.join(process.cwd(), 'output', 'cache');
    this.ttlMs = (options.ttlHours ?? Number(process.env.CACHE_TTL_HOURS ?? 24)) * 3_600_000;
    this.enabled = options.enabled !== false;
  }

  _keyToFile(key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    const safe = key.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    return path.join(this.dir, `${safe}_${hash}.json`);
  }

  async get(key) {
    if (!this.enabled) return null;
    const file = this._keyToFile(key);
    try {
      const raw = await readFile(file, 'utf8');
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > this.ttlMs) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  async set(key, data) {
    if (!this.enabled) return;
    try {
      if (!existsSync(this.dir)) await mkdir(this.dir, { recursive: true });
      const file = this._keyToFile(key);
      await writeFile(file, JSON.stringify({ ts: Date.now(), key, data }, null, 2));
    } catch { /* non-fatal */ }
  }

  async getOrFetch(key, fetchFn) {
    const cached = await this.get(key);
    if (cached !== null) return { data: cached, fromCache: true };
    const data = await fetchFn();
    await this.set(key, data);
    return { data, fromCache: false };
  }

  async invalidate(key) {
    const file = this._keyToFile(key);
    try {
      const { unlink } = await import('fs/promises');
      await unlink(file);
    } catch { /* non-fatal */ }
  }
}
