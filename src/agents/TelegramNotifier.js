/**
 * TelegramNotifier — 텔레그램 Bot API "나에게 보내기" (**유일한 알림 채널**)
 *
 * 왜 생겼나 (2026-08-01): 알림 채널 전역 방침이 텔레그램으로 확정됐다. 이 repo의
 * 데일리 리포트는 카카오로만 오고 있었는데, 텔레그램으로 논문 리포트를 보내던 별도
 * 파이프라인(Trend_Review_v2)이 정리되면서 그 자리를 여기서 메운다.
 * (2026-08-04) 카카오 refresh 토큰이 만료(KOE322)됐고 재발급이 번거로워 **카카오는 폐지**,
 * 전 발송 지점을 텔레그램 단일 채널로 통일했다(PeterJ 확정). 발송 실패는 여전히
 * 소프트 — 알림이 실패해도 파이프라인은 성공 처리다.
 *
 * 메시지 텍스트는 `src/utils/reportMessage.js`가 정본이다 — REPORT_SPEC §2 → 그 파일
 * 한 곳. 채널 모듈은 텍스트를 만들지 않고 실어 나르기만 한다.
 * (빌더의 200자 분할은 카카오 상한에서 온 규칙이나 "제목을 자르지 않는다"를 보장하는
 *  구조라 유지 — 텔레그램은 4096자 한도라 join해서 한 메시지로 보낸다.)
 *
 * 보안: 봇 토큰이 URL에 들어가므로 **에러 메시지에 URL을 넣지 않는다**
 * (Actions 로그는 남는다). parse_mode 미사용 — 본문이 마크업으로 해석되지 않는다.
 */
import { buildReportMessages, buildFailureText } from '../utils/reportMessage.js';
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

  /**
   * md 파일 첨부. PeterJ 요구: *"각 1 2 3 분석 내용도 md파일 첨부해서 텔레그램에서 바로
   * 볼수있게"* — 텔레그램은 .md 를 앱 안에서 미리보기로 열어준다.
   *
   * ★ 첨부 실패가 리포트 발송을 막으면 안 된다. 본문은 이미 갔거나 갈 것이고,
   *   첨부는 부가물이다. 그래서 던지지 않고 성공 여부만 돌려준다.
   */
  async sendDocument({ filename, content, caption }) {
    if (!this.isConfigured) return false;
    try {
      const form = new FormData();
      form.append('chat_id', this.chatId);
      if (caption) form.append('caption', caption.slice(0, 1024));   // 텔레그램 캡션 상한
      form.append('document', new Blob([content], { type: 'text/markdown' }), filename);
      const res = await fetch(`${API_BASE}/bot${this.token}/sendDocument`, { method: 'POST', body: form });
      if (!res.ok) {
        let desc = '';
        try { desc = (await res.json())?.description ?? ''; } catch { /* 상태코드로 충분 */ }
        this.logger.warn('md 첨부 실패 — 리포트 본문은 그대로 간다', { status: res.status, desc });
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn('md 첨부 실패 — 리포트 본문은 그대로 간다', { err: err.message });
      return false;
    }
  }

  // ── 발송 (성공 리포트) — 데일리·on-demand가 발행 직후 호출 ────────────────────
  async send({ dateStr, topPaper, pagesUrl, progressLines = [] }) {
    if (!this.isConfigured) {
      this.logger.info('Telegram 미설정(TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 없음) — 발송 생략');
      return { sent: false, reason: 'not-configured' };
    }
    // ★ 메시지 사이는 **빈 줄**로 잇는다 (2026-08-18 포맷 개정). 본문과 진행상황이
    //   줄바꿈 하나로 붙으면 본문 마지막 줄(📊 링크)에 진행상황이 달라붙어 보인다.
    const text = buildReportMessages({ dateStr, topPaper, pagesUrl, progressLines }).join('\n\n');
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
    await this._post(buildFailureText({ dateStr, reason }));
    this.logger.warn('텔레그램 실패 알림 발송', { reason });
    return { sent: true };
  }

  // ── 발송 (범용 공지 — NotebookLM 리마인더 등) ─────────────────────────────────
  // 카카오는 링크를 '버튼'으로 붙였지만(본문에 URL을 넣으면 텍스트 상한에 잘려 링크가
  // 깨졌다), 텔레그램은 4096자라 URL을 본문 마지막 줄에 그대로 둔다 — 자동 링크화된다.
  async sendNotice({ text, url, buttonTitle }) {
    if (!this.isConfigured) {
      this.logger.info('Telegram 미설정 — 공지 발송 생략');
      return { sent: false, reason: 'not-configured' };
    }
    const link = url ? `${buttonTitle ? `${buttonTitle}\n` : ''}${url}` : '';
    await this._post([text, link].filter(Boolean).join('\n'));
    this.logger.info('텔레그램 공지 발송 완료');
    return { sent: true };
  }
}
