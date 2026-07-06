#!/usr/bin/env node
/**
 * google-auth-setup.mjs — 데스크탑 데이 1회 실행.
 * credentials.json(데스크탑 앱 OAuth 클라이언트)을 저장소 루트에 두고 실행하면
 * 브라우저 승인 → refresh token을 화면에 1회 출력한다(GitHub Secrets 등록용).
 * 이 값은 비밀이다 — Secrets 등록 후 터미널 기록을 지울 것.
 *
 * 사용: node scripts/google-auth-setup.mjs
 * 상세 순서: docs/desktop-day-guide.md
 */
import { google } from 'googleapis';
import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { exec } from 'child_process';
import { GOOGLE_SCOPES } from '../src/utils/googleAuth.js';

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;

let creds;
try {
  creds = JSON.parse(readFileSync('credentials.json', 'utf8'));
} catch {
  console.error('✖ credentials.json 이 없습니다 — docs/desktop-day-guide.md 2번(OAuth 클라이언트 생성)부터 진행하세요.');
  process.exit(1);
}
const { client_id, client_secret } = creds.installed ?? creds.web ?? {};
if (!client_id || !client_secret) {
  console.error('✖ credentials.json 형식이 다릅니다 — "데스크탑 앱" 유형 클라이언트의 JSON을 받으세요.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT);
const url = oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES });

const server = createServer(async (req, res) => {
  try {
    const code = new URL(req.url, REDIRECT).searchParams.get('code');
    if (!code) { res.end(); return; }
    // charset 명시 필수 — 없으면 브라우저가 한글 응답을 latin1로 렌더해 깨진다(mojibake).
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>✅ 인증 완료 — 이 창을 닫고 터미널로 돌아가세요.</h2>');
    server.close();
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      console.error('✖ refresh_token이 없습니다 — 동의 화면에서 기존 승인을 삭제(myaccount.google.com/permissions) 후 다시 실행하세요.');
      process.exit(1);
    }
    mkdirSync('output', { recursive: true });
    writeFileSync('output/google_token.json', JSON.stringify(tokens, null, 2));
    console.log('\n✅ output/google_token.json 저장 완료 (데스크탑 실행용 · gitignore 대상)');
    console.log('\nGitHub Secrets 에 등록하세요 (repo → Settings → Secrets and variables → Actions):');
    console.log(`  GOOGLE_CLIENT_ID     = ${client_id}`);
    console.log(`  GOOGLE_CLIENT_SECRET = ${client_secret}`);
    console.log(`  GOOGLE_REFRESH_TOKEN = ${tokens.refresh_token}`);
    console.log('\n⚠️ 위 값은 비밀입니다. 등록 후 터미널 기록을 지우세요 (history -c 등).');
  } catch (e) {
    console.error(`✖ 토큰 교환 실패: ${e.message}`);
    process.exit(1);
  }
});
server.listen(PORT, () => {
  console.log('브라우저에서 Google 승인을 진행하세요. 자동으로 열리지 않으면 아래 URL을 여세요:\n');
  console.log(url + '\n');
  const opener = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(opener, () => {});
});
