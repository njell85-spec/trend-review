/**
 * NotificationAgent
 * Google Drive 업로드 + Gmail 발송 (googleapis OAuth2, ENABLE_GMAIL=true 시 활성)
 *
 * 첫 실행 시 브라우저 인증 → token.json 저장 → 이후 자동
 * KakaoTalk 알림은 Claude MCP(PlayMCP)를 통해 발송 — 이 에이전트에서는 처리하지 않음
 */
import { google } from 'googleapis';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import { exec } from 'child_process';
import http from 'http';
import path from 'path';
import { Logger } from '../utils/Logger.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
];

export class NotificationAgent {
  constructor(options = {}) {
    this.logger = new Logger('NotificationAgent', { logFile: 'notification.jsonl' });
    this.credentialsPath = options.credentialsPath
      ?? process.env.GOOGLE_CREDENTIALS_PATH
      ?? './credentials.json';
    this.tokenPath = path.join(process.cwd(), 'output', 'google_token.json');
    this.recipientEmail = options.recipientEmail ?? process.env.NOTIFY_EMAIL;
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
    const authUrl = oAuth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
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

      server.listen(3000, () => {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔐 브라우저에서 Google 계정으로 로그인 후');
        console.log('   권한을 허용하면 자동으로 완료됩니다.');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        exec(`start "" "${authUrl}"`);
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

  // ── Gmail 발송 (본문 HTML + 첨부파일) ──────────────────────────────────
  async _sendEmail(auth, { to, subject, htmlBody, attachments = [] }) {
    const gmail = google.gmail({ version: 'v1', auth });
    const outer = `outer_${Date.now()}`;
    const inner = `inner_${Date.now()}`;

    // multipart/mixed: 본문 + 첨부
    const parts = [
      `To: ${to}`,
      `From: me`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${outer}"`,
      '',
      `--${outer}`,
      `Content-Type: multipart/alternative; boundary="${inner}"`,
      '',
      `--${inner}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(htmlBody, 'utf8').toString('base64'),
      `--${inner}--`,
    ];

    for (const att of attachments) {
      const content = (await readFile(att.path)).toString('base64');
      parts.push(
        `--${outer}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.filename}"`,
        '',
        content
      );
    }
    parts.push(`--${outer}--`);

    const raw = Buffer.from(parts.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    this.logger.info(`이메일 발송 완료 → ${to}`);
  }

  // ── 이메일 본문: 요약 + 상세 PICO ───────────────────────────────────────
  _buildEmailHtml(sessionId, driveUrl, topPapers = []) {
    const medals = ['🥇', '🥈', '🥉'];
    const evidenceColor = { High:'#10b981', Moderate:'#3b82f6', Low:'#f59e0b', 'Very Low':'#ef4444' };

    const picoCards = topPapers.slice(0, 1).map((p, i) => {
      const score = p.clinicalApplicabilityScore ?? p.paper?.scoringData?.score ?? '—';
      const title = p.paper?.title ?? '제목 없음';
      const journal = p.paper?.journal ?? '';
      const authors = (p.paper?.authors ?? []).slice(0, 3).join(', ');
      const pubDate = p.paper?.pubDate ?? '';
      const pico = p.pico ?? {};
      const evidence = p.evidenceLevel ?? '—';
      const evColor = evidenceColor[evidence] ?? '#6b7280';
      const findings = (p.keyFindings ?? []).map(f => `<li style="margin:4px 0">${f}</li>`).join('');
      const pmUrl = p.paper?.pubmedUrl ?? '#';

      return `
<div style="border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:20px;border-left:4px solid #3b82f6">
  <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
    <span style="font-size:24px">${medals[i]}</span>
    <div style="flex:1">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
        <span style="background:#3b82f6;color:white;padding:2px 10px;border-radius:999px;font-weight:700;font-size:13px">${score}점</span>
        <span style="background:${evColor};color:white;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">${evidence}</span>
      </div>
      <a href="${pmUrl}" style="color:#1e3a5f;font-weight:700;font-size:15px;text-decoration:none">${title}</a>
      <div style="color:#6b7280;font-size:12px;margin-top:4px">${authors} · ${journal} (${pubDate})</div>
    </div>
  </div>

  <!-- 임상 질문 -->
  <div style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px 12px;border-radius:4px;margin-bottom:12px">
    <div style="font-size:11px;font-weight:700;color:#2563eb;margin-bottom:4px">📌 임상 질문</div>
    <div style="font-size:13px;color:#374151">${p.clinicalQuestion ?? '—'}</div>
  </div>

  <!-- PICO -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px">
    <tr style="background:#f8fafc">
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;color:#374151;width:28%">👥 P (대상)</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;color:#374151">${pico.population ?? '—'}</td>
    </tr>
    <tr>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;color:#374151">💉 I (중재)</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;color:#374151">${pico.intervention ?? '—'}</td>
    </tr>
    <tr style="background:#f8fafc">
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;color:#374151">⚖️ C (비교)</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;color:#374151">${pico.comparison ?? '—'}</td>
    </tr>
    <tr>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;color:#374151">📊 O (결과)</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;color:#374151">${pico.outcome ?? '—'}</td>
    </tr>
  </table>

  <!-- 핵심 결과 -->
  ${findings ? `<div style="margin-bottom:12px">
    <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">🔑 핵심 결과</div>
    <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px">${findings}</ul>
  </div>` : ''}

  <!-- 임상 적용 -->
  <div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 12px;border-radius:4px;margin-bottom:8px">
    <div style="font-size:11px;font-weight:700;color:#d97706;margin-bottom:4px">⚡ 임상 적용 포인트</div>
    <div style="font-size:13px;color:#374151">${p.clinicalTakeaway ?? '—'}</div>
  </div>

  <div style="font-size:11px;color:#9ca3af"><strong>제한점:</strong> ${p.limitations ?? '—'}</div>
</div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:0">
<div style="max-width:680px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

  <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:32px 36px;color:white">
    <div style="font-size:28px;margin-bottom:4px">🏥</div>
    <h1 style="margin:0;font-size:20px;font-weight:700">Trend Review 논문 분석 완료</h1>
    <p style="margin:8px 0 0;color:#bfdbfe;font-size:13px">최근 6개월(180일) 응급의학·중환자의학 문헌 자동 분석 · Claude Opus</p>
  </div>

  <div style="padding:32px 36px">
    <p style="color:#374151;margin-top:0">PubMed 최근 6개월 논문 <strong>최대 300편</strong>을 스크리닝하여 임상 적용성 기준 <strong>오늘의 1편</strong>을 선정했습니다.<br>
    전체 인터랙티브 대시보드는 첨부된 HTML 파일 또는 Google Drive 링크에서 확인하세요.</p>

    <a href="${driveUrl}" style="display:block;background:#2563eb;color:white;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;text-align:center;margin-bottom:28px">
      📊 Google Drive에서 대시보드 열기
    </a>

    <h2 style="font-size:17px;color:#1e3a5f;border-bottom:2px solid #dbeafe;padding-bottom:10px;margin-bottom:20px">
      🏆 오늘의 선정 논문 — PICO 상세 분석
    </h2>

    ${picoCards}

    <p style="margin-top:24px;font-size:11px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px">
      Session: ${sessionId} · 생성: ${new Date().toLocaleString('ko-KR')}<br>
      본 분석 결과는 보조 도구이며, 임상 결정은 전문의 판단을 따르십시오.
    </p>
  </div>
</div>
</body></html>`;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async run(sessionId, { htmlPath, jsonPath }, topPapers = [], pagesUrl = null) {
    this.logger.section('NotificationAgent' + (process.env.ENABLE_GMAIL === 'true' ? ' — Drive & Gmail' : ' — (Gmail 비활성)'));

    // ── Google Drive + Gmail (ENABLE_GMAIL=true 일 때만) ──────────────────
    let driveHtmlUrl = null;
    if (process.env.ENABLE_GMAIL === 'true') {
      if (!this.recipientEmail) {
        throw new Error('NOTIFY_EMAIL이 설정되지 않았습니다 (.env 확인)');
      }

      const auth = await this._getAuth();

      const htmlFile = await this._uploadFile(
        auth, htmlPath,
        `Trend_Review_${sessionId}.html`, 'text/html'
      );
      driveHtmlUrl = htmlFile.webViewLink;

      await this._sendEmail(auth, {
        to: this.recipientEmail,
        subject: `[Trend Review] 최신 논문 분석 완료 — ${new Date().toLocaleDateString('ko-KR')}`,
        htmlBody: this._buildEmailHtml(sessionId, htmlFile.webViewLink, topPapers),
        attachments: [
          { path: htmlPath, filename: `Trend_Review_${sessionId}.html`, mimeType: 'text/html' },
        ],
      });
    }

    return {
      ...(driveHtmlUrl && { driveHtmlUrl, sentTo: this.recipientEmail }),
    };
  }
}
