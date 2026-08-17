/**
 * reportMessage — 알림 메시지 텍스트의 정본 (REPORT_SPEC §2).
 *
 * 채널(텔레그램)과 분리해 둔 이유: 포맷을 채널 모듈 안에 두면 채널을 갈아끼울 때마다
 * 포맷이 따라 움직이고, 두 채널이 공존하던 시절엔 한쪽만 고쳐져 서로 다른 말을 했다.
 * 텍스트 규격은 여기 한 곳이고, 채널 모듈은 이 결과를 실어 나르기만 한다.
 *
 * ── 2026-08-18 포맷 개정 (PeterJ 확정) ──────────────────────────────────────
 * 사유는 **가독성** 이다. 다섯 줄이 빈 줄 없이 붙어 있어 폰에서 덩어리로 보였다.
 * 확정 포맷 — **빈 줄 위치가 규격의 일부다**:
 * ```
 * [trend-review]
 *                      ← 빈 줄
 * 2026-08-17
 * 발관 후 호흡부전에 대한 구제 비침습적 환기(rescue NIV)의 사용
 * Critical care (London, England) · #41188988
 *                      ← 빈 줄
 * 📊 https://njell85-spec.github.io/trend-review/
 * ```
 *
 * ★ 200자 2건 분할을 **없앴다.** 그 규칙은 카카오 나챗방 상한(200자)에서 온 것인데
 *   카카오는 2026-08-04 에 폐지됐고 텔레그램 상한은 4096자다. 남겨 두면 긴 제목일 때
 *   본문이 두 메시지로 갈리면서 **위 빈 줄 배치가 깨진다** — 규격과 정면으로 충돌한다.
 *   대신 4096 을 넘길 때만 **제목 하나를 잘라** 구조를 지킨다(구조 > 제목 전문).
 *   되돌리려는 다음 세션에게: 분할을 되살리면 PeterJ 가 고쳐 달라고 한 그 증상이 돌아온다.
 */

// 텔레그램 sendMessage 본문 상한. 여유를 두고 자른다(이모지·URL 은 코드포인트로 셈).
const TELEGRAM_LIMIT = 4096;
const SAFE_LIMIT = 3900;

export function buildReportMessages({ dateStr, topPaper, pagesUrl, progressLines = [] }) {
  const p = topPaper ?? {};
  const paper = p.paper ?? {};
  const title = (p.title_ko || paper.title || '제목 없음').replace(/\s+/g, ' ').trim();
  const journal = paper.journal ?? '';
  const pmid = paper.pmid ?? '';
  const url = pagesUrl || 'https://njell85-spec.github.io/trend-review/';

  const head = '[trend-review]';
  const meta = `${journal}${pmid ? `${journal ? ' · ' : ''}#${pmid}` : ''}`; // 어느 논문인지
  const link = `📊 ${url}`;

  // 빈 줄은 '' 원소로 표현한다 — join('\n') 이 곧 규격이다.
  const compose = (t) => [head, '', dateStr, t, meta, '', link].filter((l) => l !== null).join('\n');

  let body = compose(title);
  if (body.length > SAFE_LIMIT) {
    // 초장문 제목 방어 — **구조를 지키고 제목만** 자른다. 자른 사실을 …로 남긴다.
    const overflow = body.length - SAFE_LIMIT;
    const budget = Math.max(12, title.length - overflow - 1);
    body = compose(`${title.slice(0, budget)}…`);
  }

  // ★ 진행상황은 **별도 메시지**다. 본문 규격(빈 줄 배치)에 끼워 넣으면 규격이 깨진다.
  //   채널 모듈이 메시지 사이를 빈 줄로 잇는다(TelegramNotifier).
  const progress = progressLines.length ? ['[진행상황]', ...progressLines].join('\n') : null;
  return progress ? [body, progress] : [body];
}

// ── 실패 알림 텍스트 (자동 업데이트가 최종 실패했을 때) ──────────────────────
// 과거엔 실패 시 아무 알림도 못 보내거나 오진("GitHub 권한 오류")이 나갔다.
// 진짜 사유(예: 'Claude 세션 한도(429) — 3회 재시도 후 실패')를 그대로 전달한다.
export function buildFailureText({ dateStr, reason }) {
  const lines = [
    '[Trend Review] ⚠️ 자동 업데이트 실패',
    `${dateStr} · ${reason}`,
    '사이트는 이전 상태 유지 · 다음 스케줄에 재시도',
  ];
  let text = lines.join('\n');
  if (text.length > 195) text = `${text.slice(0, 193)}…`;
  return text;
}

export { TELEGRAM_LIMIT, SAFE_LIMIT };
