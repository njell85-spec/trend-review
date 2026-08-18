/**
 * reportMessage — 알림 메시지 텍스트의 정본 (REPORT_SPEC §2).
 *
 * 채널(텔레그램)과 분리해 둔 이유: 포맷을 채널 모듈 안에 두면 채널을 갈아끼울 때마다
 * 포맷이 따라 움직이고, 두 채널이 공존하던 시절엔 한쪽만 고쳐져 서로 다른 말을 했다.
 * 텍스트 규격은 여기 한 곳이고, 채널 모듈은 이 결과를 실어 나르기만 한다.
 *
 * ── 2026-08-18 포맷 개정 (PeterJ 확정) ──────────────────────────────────────
 * 사유는 **가독성**이다. 빈 줄 위치가 규격의 일부다.
 *
 * ★★ 같은 날 2차 개정 — **세 트랙을 다 싣는다** (PeterJ 실측 피드백):
 *   *"그날 선정된 논문리스트만 있음. 논문 가이드라인 리뷰 등 그날 선정된 리스트는
 *     각각 모두 제시. 모두 줄바꿈 및 한줄씩 띄워 가독성 확보할 것."*
 *   종전에는 `topPaper` 하나만 실었다. 세 트랙이 매일 도는데 알림은 논문만 말했고,
 *   그래서 가이드라인·리뷰가 나갔는지 알 길이 대시보드를 여는 것뿐이었다.
 *
 * 확정 포맷 — 트랙 블록 사이는 **빈 줄 하나**:
 * ```
 * [trend-review]
 *
 * 2026-08-18
 *
 * 📄 논문
 * Part 9: 성인 전문소생술(Advanced Life Support)
 * Circulation · #41122884
 *
 * 📋 가이드라인
 * 2026 급성 허혈성 뇌졸중 초기 관리 지침
 * Stroke · #41582814
 *
 * 📰 리뷰
 * 패혈증(Sepsis)
 * Lancet (London, England) · #41765030
 *
 * 📊 https://njell85-spec.github.io/trend-review/
 * ```
 *
 * ★ 200자 2건 분할은 **없앴다.** 카카오 나챗방 상한(200자)에서 온 규칙인데 카카오는
 *   2026-08-04 에 폐지됐고 텔레그램 상한은 4096자다. 남겨 두면 긴 제목일 때 본문이
 *   두 메시지로 갈리면서 **빈 줄 배치가 깨진다** — 규격과 정면으로 충돌한다.
 *   대신 4096 을 넘길 때만 **제목을 잘라** 구조를 지킨다(구조 > 제목 전문).
 *   되돌리려는 다음 세션에게: 분할을 되살리면 PeterJ 가 고쳐 달라고 한 증상이 돌아온다.
 */

// 텔레그램 sendMessage 본문 상한. 여유를 두고 자른다.
const TELEGRAM_LIMIT = 4096;
const SAFE_LIMIT = 3900;

/** 트랙 표시 순서·라벨. 화면(페이지 탭)과 같은 순서다. */
const TRACK_LABELS = [
  ['paper', '📄 논문'],
  ['guideline', '📋 가이드라인'],
  ['review', '📰 리뷰'],
];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * 분석 결과 하나에서 {title, journal, pmid} 를 뽑는다.
 *
 * ★ 트랙마다 객체 모양이 다르다 — 논문은 `{title_ko, paper:{...}}`, 가이드라인 카드는
 *   `{title_ko, paper:{...}}`, 리뷰 큐 항목은 `{pmid, title, journal, card:{...}}` 다.
 *   여기서 한 번에 흡수한다. 모양이 또 생기면 **이 함수만** 고친다.
 */
function itemOf(raw) {
  if (!raw) return null;
  const src = raw.card ?? raw;                 // 리뷰 큐 항목은 분석이 card 안에 있다
  const paper = src.paper ?? raw.paper ?? {};
  const title = clean(src.title_ko || paper.title || src.title || raw.title);
  const journal = clean(paper.journal || src.journal || raw.journal);
  const pmid = clean(paper.pmid || src.pmid || raw.pmid);
  if (!title && !pmid) return null;
  return { title: title || '제목 없음', journal, pmid };
}

/** 한 트랙 블록: 라벨 / 제목 / 저널·#PMID */
function trackBlock(label, item) {
  const meta = `${item.journal}${item.pmid ? `${item.journal ? ' · ' : ''}#${item.pmid}` : ''}`;
  return [label, item.title, meta].filter(Boolean).join('\n');
}

/**
 * @param {string} dateStr        KST YYYY-MM-DD
 * @param {object} topPaper       논문 트랙 분석(종전 인자 — 그대로 받는다)
 * @param {object} guideline      가이드라인 카드
 * @param {object} review         리뷰 발행 항목(`.card` 안에 분석)
 * @param {string} pagesUrl
 * @param {string[]} progressLines
 */
export function buildReportMessages({
  dateStr, topPaper, guideline = null, review = null, pagesUrl, progressLines = [],
} = {}) {
  const url = pagesUrl || 'https://njell85-spec.github.io/trend-review/';
  const byTrack = { paper: itemOf(topPaper), guideline: itemOf(guideline), review: itemOf(review) };

  const compose = (items) => {
    const blocks = TRACK_LABELS
      .map(([key, label]) => (items[key] ? trackBlock(label, items[key]) : null))
      .filter(Boolean);
    // 발행이 하나도 없으면 그렇게 말한다 — 빈 알림은 고장과 구분이 안 된다.
    const body = blocks.length ? blocks : ['오늘 발행된 것이 없습니다.'];
    return ['[trend-review]', '', dateStr, '', ...body.flatMap((b) => [b, '']), `📊 ${url}`].join('\n');
  };

  let text = compose(byTrack);
  if (text.length > SAFE_LIMIT) {
    // 초장문 방어 — **구조를 지키고 제목만** 자른다. 자른 사실을 …로 남긴다.
    const over = text.length - SAFE_LIMIT;
    const longest = Object.entries(byTrack)
      .filter(([, v]) => v)
      .sort((a, b) => b[1].title.length - a[1].title.length)[0];
    if (longest) {
      const [key, item] = longest;
      const budget = Math.max(12, item.title.length - over - 1);
      byTrack[key] = { ...item, title: `${item.title.slice(0, budget)}…` };
      text = compose(byTrack);
    }
    if (text.length > TELEGRAM_LIMIT) text = `${text.slice(0, TELEGRAM_LIMIT - 1)}…`;
  }

  // ★ 진행상황은 **별도 메시지**다. 본문 규격(빈 줄 배치)에 끼워 넣으면 규격이 깨진다.
  //   채널 모듈이 메시지 사이를 빈 줄로 잇는다(TelegramNotifier).
  const progress = progressLines.length ? ['[진행상황]', ...progressLines].join('\n') : null;
  return progress ? [text, progress] : [text];
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
