/**
 * NotificationAgent — Google Drive 업로드 (googleapis OAuth2).
 *
 * ⚠️ 현재 데일리 파이프라인에서 사용하지 않는다.
 *   · 이메일(Gmail) 발송: 사용 안 함(PeterJ 확정, 2026-07-05) — 알림은 카카오 단일 채널.
 *   · Drive 업로드: 지금은 미사용이나, phase2/3 산출물 연동 대비 인프라를 보존한다.
 *     ENABLE_DRIVE=true + credentials.json 이 있을 때만 동작(기본 비활성).
 *
 * 첫 실행 시 브라우저 인증 → output/google_token.json 저장 → 이후 자동.
 * 카카오 알림은 KakaoNotifier(REST API)가 담당 — 이 에이전트와 무관.
 */
import { google } from 'googleapis';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import { exec } from 'child_process';
import http from 'http';
import path from 'path';
import { Logger } from '../utils/Logger.js';

// Drive 업로드만 — Gmail 스코프는 이메일 미사용으로 제거.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export class NotificationAgent {
  constructor(options = {}) {
    this.logger = new Logger('NotificationAgent', { logFile: 'notification.jsonl' });
    this.credentialsPath = options.credentialsPath
      ?? process.env.GOOGLE_CREDENTIALS_PATH
      ?? './credentials.json';
    this.tokenPath = path.join(process.cwd(), 'output', 'google_token.json');
    this.driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID ?? null;
  }

  // ── OAuth2 인증 ──────────────────────────────────────────────────────────
  async _getAuth() {
    const raw = await readFile(this.credentialsPath, 'utf8').catch(() => {
      throw new Error(`credentials.json을 찾을 수 없습니다: ${this.credentialsPath}`);
    });
    const creds = JSON.parse(raw);
    const { client_id, client_secret } = creds.installed ?? creds.web;

    // 로컬 서버 방식: redirect_uri = http://localhost:3000
    const REDIRECT = 'http://localhost:3000';
    const oAuth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT);

    // 저장된 토큰 재사용
    if (existsSync(this.tokenPath)) {
      const token = JSON.parse(await readFile(this.tokenPath, 'utf8'));
      oAuth2.setCredentials(token);
      this.logger.info('기존 Google 토큰 사용');
      return oAuth2;
    }

    return this._firstTimeAuth(oAuth2);
  }

  async _firstTimeAuth(oAuth2) {
    // prompt:'consent' — 재인증 시에도 refresh_token이 반드시 내려오도록
    const authUrl = oAuth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
    this.logger.info('최초 Google 인증 — 브라우저가 열립니다');

    // 로컬 HTTP 서버로 리디렉션 코드 자동 수신
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost:3000');
          const code = url.searchParams.get('code');
          if (!code) { res.end('코드 없음'); return; }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>✅ Google 인증 완료!</h2><p>이 창을 닫고 터미널로 돌아가세요.</p>');
          server.close();

          const { tokens } = await oAuth2.getToken(code);
          oAuth2.setCredentials(tokens);

          const dir = path.dirname(this.tokenPath);
          if (!existsSync(dir)) await mkdir(dir, { recursive: true });
          await writeFile(this.tokenPath, JSON.stringify(tokens, null, 2));
          this.logger.info('Google 토큰 저장 완료');
          resolve(oAuth2);
        } catch (err) {
          res.end('오류: ' + err.message);
          server.close();
          reject(err);
        }
      });

      server.on('error', (err) => { reject(new Error(`인증 서버 시작 실패(:3000): ${err.message}`)); });
      server.listen(3000, () => {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔐 아래 URL을 브라우저에서 열어 Google 계정으로 로그인 후');
        console.log('   권한을 허용하면 자동으로 완료됩니다.');
        console.log(`   ${authUrl}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        // 가능하면 기본 브라우저 자동 열기 (플랫폼별; 실패해도 위 URL 수동 사용)
        const opener = process.platform === 'win32' ? `start "" "${authUrl}"`
          : process.platform === 'darwin' ? `open "${authUrl}"`
          : `xdg-open "${authUrl}"`;
        exec(opener, () => {});
      });

      // 5분 타임아웃
      setTimeout(() => { server.close(); reject(new Error('인증 타임아웃 (5분)')); }, 300_000);
    });
  }

  // ── Google Drive 업로드 ──────────────────────────────────────────────────
  async _uploadFile(auth, filePath, fileName, mimeType) {
    const drive = google.drive({ version: 'v3', auth });

    this.logger.info(`Drive 업로드: ${fileName}`);
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        ...(this.driveFolderId && { parents: [this.driveFolderId] }),
      },
      media: { mimeType, body: createReadStream(filePath) },
      fields: 'id,webViewLink,name',
    });

    // 링크 공유 (누구나 열람 가능)
    await drive.permissions.create({
      fileId: res.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    this.logger.info(`Drive 업로드 완료: ${res.data.webViewLink}`);
    return res.data;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  // 이메일 미사용 → Drive 업로드만. ENABLE_DRIVE=true 일 때만 동작(기본 비활성).
  async run(sessionId, { htmlPath, jsonPath } = {}, topPapers = [], pagesUrl = null) {
    if (process.env.ENABLE_DRIVE !== 'true') {
      this.logger.info('NotificationAgent — Drive 비활성 (ENABLE_DRIVE 미설정) — 건너뜀');
      return {};
    }

    this.logger.section('NotificationAgent — Google Drive 업로드');
    const auth = await this._getAuth();
    const htmlFile = await this._uploadFile(
      auth, htmlPath,
      `Trend_Review_${sessionId}.html`, 'text/html'
    );

    return { driveHtmlUrl: htmlFile.webViewLink };
  }
}
