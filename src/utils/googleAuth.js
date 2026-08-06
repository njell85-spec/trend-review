/**
 * googleAuth — Drive(현재) · YouTube(Phase 3 재개 시) 공용 OAuth2 헬퍼.
 * 우선순위: ① env(GitHub Secrets: GOOGLE_CLIENT_ID/SECRET + GOOGLE_REFRESH_TOKEN)
 *          ② credentials.json + output/google_token.json (데스크탑, NotificationAgent와 동일 파일)
 * 미설정이면 null 반환 — 호출측이 소프트 스킵한다. 토큰 값은 절대 로그에 남기지 않는다.
 */
import { google } from 'googleapis';
import { readFile } from 'fs/promises';
import path from 'path';

// Drive 전용 최소 스코프. `drive.file`은 구글 분류상 **비민감(non-sensitive)**이라
// 앱을 "프로덕션"으로 게시해도 심사가 필요 없다 — 그리고 프로덕션이라야 refresh token이
// 7일마다 만료되지 않는다("테스트" 상태의 7일 만료가 2026-07-08 아카이브 사망 원인).
// `youtube.upload`는 **민감 스코프**라 함께 요구하면 게시가 심사 대상이 된다. Phase 3
// 영상 업로드는 아직 비활성(ENABLE_VIDEO=false)이므로 지금은 뺀다 — 실제로 켜는 날
// 이 배열에 다시 넣고 콘솔 스코프 추가 + 재인증 1회를 하면 된다(desktop-day-guide 3-b).
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
];

export function buildAuthConfig(env) {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  const refreshToken = env.GOOGLE_REFRESH_TOKEN || '';
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, source: 'env' };
}

export async function getGoogleAuth({ logger } = {}) {
  const cfg = buildAuthConfig(process.env);
  if (cfg) {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    logger?.info?.('Google 인증: env(Secrets) 경로');
    return oauth2;
  }
  // 데스크탑 폴백 — NotificationAgent가 쓰는 것과 같은 파일 위치
  try {
    const credPath = process.env.GOOGLE_CREDENTIALS_PATH ?? path.join(process.cwd(), 'credentials.json');
    const tokenPath = path.join(process.cwd(), 'output', 'google_token.json');
    const { installed, web } = JSON.parse(await readFile(credPath, 'utf8'));
    const { client_id, client_secret } = installed ?? web;
    const token = JSON.parse(await readFile(tokenPath, 'utf8'));
    const oauth2 = new google.auth.OAuth2(client_id, client_secret);
    oauth2.setCredentials(token);
    logger?.info?.('Google 인증: 토큰 파일 경로');
    return oauth2;
  } catch {
    logger?.info?.('Google 인증 미설정 — Drive/YouTube 단계 건너뜀');
    return null;
  }
}
