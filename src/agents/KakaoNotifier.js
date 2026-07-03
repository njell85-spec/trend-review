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
const KAKAO_TIMEOUT_MS = 15_000;

export class KakaoNotifier {
  constructor(options = {}) {
    this.logger = new Logger('KakaoNotifier', { logFile: 'kakao.jsonl' });
    this.restApiKey = options.restApiKey ?? process.env.KAKAO_REST_API_KEY;
    this.refreshToken = options.refreshToken ?? process.env.KAKAO_REFRESH_TOKEN;
    this.clientSecret = options.clientSecret ?? process.env.KAKAO_CLIENT_SECRET ?? null;
    this._rotationDetected = false; // 이번 실행에서 refresh 토큰 회전을 감지했는지
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
      signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      throw new Error(`Kakao token refresh failed ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    // 카카오가 refresh_token 을 새로 주면(회전) 저장된 secret 이 곧 만료된다.
    // 무인 Actions에서는 로그 파일을 아무도 안 보므로, 옛 토큰이 살아있는 지금
    // 카톡으로도 직접 알린다(_notifyRotation — 발송 후 호출).
    // 토큰 값 자체는 절대 로그/메시지에 싣지 않는다 (public repo Actions 로그는 공개).
    if (data.refresh_token) {
      this._rotationDetected = true;
      this.logger.warn('Kakao issued a NEW refresh_token — update KAKAO_REFRESH_TOKEN secret', {
        newRefreshTokenTail: String(data.refresh_token).slice(-6),
      });
      // GitHub Actions 로그에서 눈에 띄는 경고 어노테이션
      console.log('::warning::Kakao refresh 토큰이 회전되었습니다 — KAKAO_REFRESH_TOKEN secret을 재발급·갱신하지 않으면 곧 카톡 알림이 중단됩니다.');
    }
    return data.access_token;
  }

  // 회전 감지 시 기존 토큰이 아직 유효한 동안 카톡으로 갱신 안내 발송 (best-effort)
  async _notifyRotation() {
    if (!this._rotationDetected) return;
    this._rotationDetected = false; // 재귀/중복 발송 방지
    try {
      await this._postMemo(
        '[Trend Review] 🔑 카카오 토큰 갱신 필요\nrefresh 토큰이 회전되었습니다. 만료 전에 재발급하여 GitHub secret(KAKAO_REFRESH_TOKEN)을 갱신해 주세요. 방치 시 데일리 카톡 알림이 조용히 중단됩니다.',
        'https://github.com/njell85-spec/trend-review/settings/secrets/actions'
      );
      this.logger.warn('Kakao 토큰 갱신 안내 메모 발송 완료');
    } catch (err) {
      this.logger.warn(`Kakao 토큰 갱신 안내 발송 실패(무시): ${err.message}`);
    }
  }

  // ── 데일리 리포트 텍스트 구성 (REPORT_SPEC 카톡 포맷) ────────────────────────
  static buildReportText({ dateStr, screened = 300, topPaper, pagesUrl, llmRoute = '' }) {
    const p = topPaper ?? {};
    const paper = p.paper ?? {};
    const titleKo = p.title_ko ?? '';
    const titleEn = paper.title ?? '제목 없음';
    const title = (titleKo || titleEn).replace(/\s+/g, ' ').trim();
    const journal = paper.journal ?? '';
    const pmid = paper.pmid ?? '';
    const score = p.clinicalApplicabilityScore ?? paper.scoringData?.score ?? '';
    const url = pagesUrl || 'https://njell85-spec.github.io/trend-review/';

    // 텍스트 템플릿 200자 제한. 헤더·PMID·URL 줄은 고정하고 제목만 남는 공간에
    // 맞춰 줄인다 — 링크(마지막 줄)가 잘리지 않도록 (REPORT_SPEC §2 준수).
    // 카톡은 http(s) URL 을 자동으로 링크화하므로 https 포함 필수.
    const l1 = '[Trend Review] 논문분석완료🏥';
    const l2 = `${dateStr} · 최근6개월 ${screened}편 스크리닝 → 1편 선정`;
    const l4 = `${pmid ? `#${pmid}` : ''}${score ? ` · ${score}점` : ''}${llmRoute ? ` · ${llmRoute}` : ''}`;
    const l5 = `📊 ${url}`;
    const fixed = [l1, l2, l4, l5].filter(Boolean).join('\n');
    const budget = 195 - fixed.length - 1; // 제목 줄 개행 몫
    let titleLine = `🥇${title}${journal ? `(${journal})` : ''}`;
    if (titleLine.length > budget) titleLine = `${titleLine.slice(0, Math.max(12, budget - 1))}…`;
    return [l1, l2, titleLine, l4, l5].filter(Boolean).join('\n');
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
      signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.result_code !== 0) {
      // -402 insufficient scopes: 토큰에 talk_message 동의가 빠짐 — 갱신이 아니라
      // 카카오 로그인 동의 화면에서 '카카오톡 메시지 전송'을 체크해 재발급해야 한다.
      if (data.code === -402) {
        throw new Error(
          `Kakao memo send failed ${res.status}: talk_message 동의 없음(code -402). `
          + '카카오 디벨로퍼스에서 "카카오톡 메시지" 동의항목 활성화 후, '
          + 'scope=talk_message 로 인가코드를 다시 받아 refresh 토큰을 재발급하고 '
          + 'KAKAO_REFRESH_TOKEN secret을 갱신하세요.'
        );
      }
      throw new Error(`Kakao memo send failed ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
  }

  // ── 발송 (성공 리포트) ────────────────────────────────────────────────────────
  async send({ dateStr, screened, topPaper, pagesUrl, llmRoute = '' }) {
    if (!this.isConfigured) {
      this.logger.info('Kakao 미설정(KAKAO_REST_API_KEY/KAKAO_REFRESH_TOKEN 없음) — 발송 생략');
      return { sent: false, reason: 'not-configured' };
    }

    const text = KakaoNotifier.buildReportText({ dateStr, screened, topPaper, pagesUrl, llmRoute });
    const url = pagesUrl || 'https://njell85-spec.github.io/trend-review/';
    await this._postMemo(text, url);
    this.logger.info('카카오 나챗방 발송 완료');
    await this._notifyRotation();
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
    await this._notifyRotation();
    return { sent: true };
  }
}
