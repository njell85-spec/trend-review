import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
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
        // 만료 파일은 지워서 output/cache 무한 증식 방지 (실패해도 무해)
        unlink(file).catch(() => {});
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
    if (cached !== null && cached !== undefined) return { data: cached, fromCache: true };
    const data = await fetchFn();
    // undefined 는 JSON 직렬화에서 유실돼 "빈 히트"가 되므로 저장하지 않는다
    if (data !== undefined) await this.set(key, data);
    return { data, fromCache: false };
  }

  async invalidate(key) {
    try {
      await unlink(this._keyToFile(key));
    } catch { /* non-fatal */ }
  }
}
