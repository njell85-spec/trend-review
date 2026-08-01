/**
 * TelegramNotifier — 텔레그램 Bot API "나에게 보내기" (카카오와 병행 발송)
 *
 * 왜 생겼나 (2026-08-01): 알림 채널 전역 방침이 텔레그램으로 확정됐다. 이 repo의
 * 데일리 리포트는 카카오로만 오고 있었는데, 텔레그램으로 논문 리포트를 보내던 별도
 * 파이프라인(Trend_Review_v2)이 정리되면서 그 자리를 여기서 메운다.
 * 카카오는 기존 채널 그대로 유지 — 두 채널 모두 "설정돼 있으면 보낸다"이고,
 * 어느 쪽이 실패해도 파이프라인은 성공 처리다(기존 카카오 관례와 동일).
 *
 * 메시지 텍스트는 KakaoNotifier의 빌더를 그대로 재사용한다 — 리포트 포맷의 정본은
 * REPORT_SPEC §2 → buildReportMessages 한 곳이다. 채널마다 포맷을 따로 두면
 * 언젠가 한쪽만 고쳐지고 두 채널이 다른 말을 한다.
 * (카카오의 200자 분할은 텔레그램에 불필요 — 4096자 한도라 한 메시지로 합쳐 보낸다.)
 *
 * 보안: 봇 토큰이 URL에 들어가므로 **에러 메시지에 URL을 넣지 않는다**
 * (Actions 로그는 남는다). parse_mode 미사용 — 본문이 마크업으로 해석되지 않는다.
 */
import { KakaoNotifier } from './KakaoNotifier.js';
import { Logger } from '../utils/Logger.js';

const API_BASE = 'https://api.telegram.org';

export class TelegramNotifier {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN ?? '';
    this.chatId = process.env.TELEGRAM_CHAT_ID ?? '';
    this.logger = new Logger('TelegramNotifier', { logFile: 'notification.jsonl' });
  }

  get isConfigured() {
    return Boolean(this.token && this.chatId);
  }

  async _post(text) {
    const res = await fetch(`${API_BASE}/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, text }),
    });
    if (!res.ok) {
      // 응답 본문의 description은 안전하다(토큰 비포함) — 사람이 원인을 보게 남긴다.
      let desc = '';
      try { desc = (await res.json())?.description ?? ''; } catch { /* 상태코드로 충분 */ }
      throw new Error(`Telegram send failed ${res.status}${desc ? `: ${desc}` : ''}`);
    }
  }

  // ── 발송 (성공 리포트) — github-actions-daily.mjs가 카카오 발송 뒤에 호출 ──────
  async send({ dateStr, topPaper, pagesUrl }) {
    if (!this.isConfigured) {
      this.logger.info('Telegram 미설정(TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 없음) — 발송 생략');
      return { sent: false, reason: 'not-configured' };
    }
    const text = KakaoNotifier.buildReportMessages({ dateStr, topPaper, pagesUrl }).join('\n');
    await this._post(text);
    this.logger.info('텔레그램 리포트 발송 완료');
    return { sent: true };
  }

  // ── 발송 (실패 알림) ──────────────────────────────────────────────────────────
  async sendFailure({ dateStr, reason }) {
    if (!this.isConfigured) {
      this.logger.info('Telegram 미설정 — 실패 알림 생략');
      return { sent: false, reason: 'not-configured' };
    }
    await this._post(KakaoNotifier.buildFailureText({ dateStr, reason }));
    this.logger.warn('텔레그램 실패 알림 발송', { reason });
    return { sent: true };
  }
}
