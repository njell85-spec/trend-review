/**
 * googleAuth — Drive·YouTube 공용 OAuth2 헬퍼.
 * 우선순위: ① env(GitHub Secrets: GOOGLE_CLIENT_ID/SECRET + GOOGLE_REFRESH_TOKEN)
 *          ② credentials.json + output/google_token.json (데스크탑, NotificationAgent와 동일 파일)
 * 미설정이면 null 반환 — 호출측이 소프트 스킵한다. 토큰 값은 절대 로그에 남기지 않는다.
 */
import { google } from 'googleapis';
import { readFile } from 'fs/promises';
import path from 'path';

/* ★ 2026-09-28 실측: 구글이 drive.file 과 youtube.upload 를 **한 동의 요청에 같이 받지 않는다**
 * ("This request contains scopes that cannot be requested together" · 400 invalid_request).
 * 그래서 용도별로 따로 승인받는다 — Drive(개인 계정) 토큰은 GOOGLE_REFRESH_TOKEN,
 * YouTube(브랜드 채널로 승인) 토큰은 GOOGLE_YT_REFRESH_TOKEN. 발급: scripts/google-auth-setup.mjs [--youtube]. */
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

/** purpose: 'drive'(기본) | 'youtube'. YouTube 전용 토큰이 없으면 예전 공용 토큰으로 떨어진다(구 토큰 호환). */
export function buildAuthConfig(env, { purpose = 'drive' } = {}) {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  const refreshToken = (purpose === 'youtube' && env.GOOGLE_YT_REFRESH_TOKEN) || env.GOOGLE_REFRESH_TOKEN || '';
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, source: 'env' };
}

export async function getGoogleAuth({ logger, purpose = 'drive' } = {}) {
  const cfg = buildAuthConfig(process.env, { purpose });
  if (cfg) {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    logger?.info?.('Google 인증: env(Secrets) 경로');
    return oauth2;
  }
  // 데스크탑 폴백 — NotificationAgent가 쓰는 것과 같은 파일 위치
  try {
    const credPath = process.env.GOOGLE_CREDENTIALS_PATH ?? path.join(process.cwd(), 'credentials.json');
    const tokenFile = purpose === 'youtube' ? 'google_yt_token.json' : 'google_token.json';
    const tokenPath = path.join(process.cwd(), 'output', tokenFile);
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
