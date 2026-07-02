/**
 * KakaoNotifier — 카카오톡 "나에게 보내기"(나와의 채팅)로 데일리 리포트 발송.
 *
 * 일반 카카오 REST API 사용 (MCP/세션 불필요) → GitHub Actions 등 서버에서 무인 발송.
 *
 * 필요한 환경변수(저장소 Secrets):
 *   KAKAO_REST_API_KEY   — 카카오 디벨로퍼스 앱의 REST API 키 (client_id)
 *   KAKAO_REFRESH_TOKEN  — talk_message 동의로 발급받은 refresh token
 *   (선택) KAKAO_CLIENT_SECRET — 앱에서 client_secret 사용 설정 시
 *
 * 토큰 발급(1회, 폰 가능): 카카오 로그인 → 동의항목 talk_message →
 *   인가코드 → access/refresh 토큰. refresh 토큰만 secret에 저장하면 매 실행 시 자동 갱신.
 */
import { Logger } from '../utils/Logger.js';

const KAUTH = 'https://kauth.kakao.com/oauth/token';
const KAPI_MEMO = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';

export class KakaoNotifier {
  constructor(options = {}) {
    this.logger = new Logger('KakaoNotifier', { logFile: 'kakao.jsonl' });
    this.restApiKey = options.restApiKey ?? process.env.KAKAO_REST_API_KEY;
    this.refreshToken = options.refreshToken ?? process.env.KAKAO_REFRESH_TOKEN;
    this.clientSecret = options.clientSecret ?? process.env.KAKAO_CLIENT_SECRET ?? null;
  }

  get isConfigured() {
    return Boolean(this.restApiKey && this.refreshToken);
  }

  // ── refresh token → access token ───────────────────────────────────────────
  async _accessToken() {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.restApiKey,
      refresh_token: this.refreshToken,
      ...(this.clientSecret ? { client_secret: this.clientSecret } : {}),
    });
    const res = await fetch(KAUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      throw new Error(`Kakao token refresh failed ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    // 카카오가 refresh_token 을 새로 주면(회전) 로그로 알림 — 운영자가 secret 갱신 판단.
    if (data.refresh_token) {
      this.logger.warn('Kakao issued a NEW refresh_token — update KAKAO_REFRESH_TOKEN secret', {
        newRefreshTokenTail: String(data.refresh_token).slice(-6),
      });
    }
    return data.access_token;
  }

  // ── 데일리 리포트 텍스트 구성 (REPORT_SPEC 카톡 포맷) ────────────────────────
  static buildReportText({ dateStr, screened = 300, topPaper, pagesUrl }) {
    const p = topPaper ?? {};
    const paper = p.paper ?? {};
    const titleKo = p.title_ko ?? '';
    const titleEn = paper.title ?? '제목 없음';
    const title = (titleKo || titleEn).replace(/\s+/g, ' ').trim();
    const shortTitle = title.length > 60 ? `${title.slice(0, 58)}…` : title;
    const journal = paper.journal ?? '';
    const pmid = paper.pmid ?? '';
    const score = p.clinicalApplicabilityScore ?? paper.scoringData?.score ?? '';

    // 텍스트 템플릿은 200자 제한 — 간결하게.
    const lines = [
      '[Trend Review] 논문분석완료🏥',
      `${dateStr} · 최근6개월 ${screened}편 스크리닝 → 1편 선정`,
      `🥇${shortTitle}${journal ? `(${journal})` : ''}`,
      `${pmid ? `#${pmid}` : ''}${score ? ` · ${score}점` : ''}`,
    ].filter(Boolean);
    let text = lines.join('\n');
    if (text.length > 195) text = `${text.slice(0, 193)}…`;
    return text;
  }

  // ── 실패 알림 텍스트 (자동 업데이트가 최종 실패했을 때) ──────────────────────
  // 과거엔 실패 시 아무 알림도 못 보내거나 오진("GitHub 권한 오류")이 나갔다.
  // 진짜 사유(예: 'Claude 세션 한도(429) — 3회 재시도 후 실패')를 그대로 전달한다.
  static buildFailureText({ dateStr, reason }) {
    const lines = [
      '[Trend Review] ⚠️ 자동 업데이트 실패',
      `${dateStr} · ${reason}`,
      '사이트는 이전 상태 유지 · 다음 스케줄에 재시도',
    ];
    let text = lines.join('\n');
    if (text.length > 195) text = `${text.slice(0, 193)}…`;
    return text;
  }

  // ── 나챗방 텍스트 메모 전송 (공통) ───────────────────────────────────────────
  async _postMemo(text, url) {
    const templateObject = {
      object_type: 'text',
      text,
      link: { web_url: url, mobile_web_url: url },
      button_title: '📊 대시보드 열기',
    };
    const accessToken = await this._accessToken();
    const res = await fetch(KAPI_MEMO, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.result_code !== 0) {
      throw new Error(`Kakao memo send failed ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
  }

  // ── 발송 (성공 리포트) ────────────────────────────────────────────────────────
  async send({ dateStr, screened, topPaper, pagesUrl }) {
    if (!this.isConfigured) {
      this.logger.info('Kakao 미설정(KAKAO_REST_API_KEY/KAKAO_REFRESH_TOKEN 없음) — 발송 생략');
      return { sent: false, reason: 'not-configured' };
    }

    const text = KakaoNotifier.buildReportText({ dateStr, screened, topPaper, pagesUrl });
    const url = pagesUrl || 'https://njell85-spec.github.io/trend-review/';
    await this._postMemo(text, url);
    this.logger.info('카카오 나챗방 발송 완료');
    return { sent: true };
  }

  // ── 발송 (실패 알림) ──────────────────────────────────────────────────────────
  async sendFailure({ dateStr, reason, pagesUrl }) {
    if (!this.isConfigured) {
      this.logger.info('Kakao 미설정 — 실패 알림 생략');
      return { sent: false, reason: 'not-configured' };
    }
    const text = KakaoNotifier.buildFailureText({ dateStr, reason });
    const url = pagesUrl || 'https://njell85-spec.github.io/trend-review/';
    await this._postMemo(text, url);
    this.logger.warn('카카오 실패 알림 발송', { reason });
    return { sent: true };
  }
}
