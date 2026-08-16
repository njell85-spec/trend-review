/**
 * reportMessage — 알림 메시지 텍스트의 정본 (REPORT_SPEC §2).
 *
 * 채널(텔레그램)과 분리해 둔 이유: 포맷을 채널 모듈 안에 두면 채널을 갈아끼울 때마다
 * 포맷이 따라 움직이고, 두 채널이 공존하던 시절엔 한쪽만 고쳐져 서로 다른 말을 했다.
 * 텍스트 규격은 여기 한 곳이고, 채널 모듈은 이 결과를 실어 나르기만 한다.
 *
 * (2026-08-04 카카오 폐지 시 KakaoNotifier에서 그대로 옮겨온 코드 — 텍스트 무변경.
 *  200자 분할은 카카오 나챗방 상한에서 온 규칙인데, §2의 "제목을 자르지 않는다"를
 *  보장하는 구조라 유지한다. 텔레그램은 4096자 한도라 join해서 1건으로 보낸다.)
 */

export function buildReportMessages({ dateStr, topPaper, pagesUrl, progressLines = [] }) {
  const p = topPaper ?? {};
  const paper = p.paper ?? {};
  const title = (p.title_ko || paper.title || '제목 없음').replace(/\s+/g, ' ').trim();
  const journal = paper.journal ?? '';
  const pmid = paper.pmid ?? '';
  const url = pagesUrl || 'https://njell85-spec.github.io/trend-review/';

  const l1 = '[trend-review]';
  const l2 = dateStr;
  const l4 = `${journal}${pmid ? `${journal ? ' · ' : ''}#${pmid}` : ''}`; // 어느 논문인지
  const l5 = `📊 ${url}`;

  // ★ 진행상황은 **별도 메시지**로 붙인다. 기존 5줄 본문은 200자 계약(REPORT_SPEC §4-D)
  //   아래 있고 분할 규칙이 거기 맞춰져 있다 — 본문에 끼워 넣으면 그 계약이 깨진다.
  const progress = progressLines.length
    ? [`[진행상황]`, ...progressLines].join('\n')
    : null;
  const withProgress = (msgs) => (progress ? [...msgs, progress] : msgs);

  const full = [l1, l2, title, l4, l5].filter(Boolean).join('\n');
  if (full.length <= 200) return withProgress([full]);

  // 200 초과 → 제목을 자르지 않고 2개로 분할. ① 헤더+날짜+제목  ② 저널·PMID + 링크
  let msg1 = [l1, l2, title].join('\n');
  if (msg1.length > 200) { // 초장문 제목 방어
    const budget = 200 - l1.length - l2.length - 2 - 1;
    msg1 = [l1, l2, `${title.slice(0, Math.max(12, budget))}…`].join('\n');
  }
  const msg2 = [l4, l5].filter(Boolean).join('\n');
  return withProgress([msg1, msg2]);
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
