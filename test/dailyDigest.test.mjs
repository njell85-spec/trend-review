import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDailyDigest, dailyDigestFilename, md } from '../src/utils/dailyDigest.js';

// PeterJ 확정 2026-08-18 — "그날 분석한 내용 **동일내용**으로 md". 요약이 아니라
// 카드가 그리는 축을 그대로 옮기는 것이 규격이다.

const paper = {
  title_ko: '심정지 후 보존적 산소요법',
  clinicalApplicabilityScore: 8,
  evidenceSource: '본문(PMC)',
  clinicalQuestion: 'Does conservative oxygen help?',
  clinicalQuestion_ko: '보존적 산소요법이 도움이 되는가?',
  pico: { population: 'adults', intervention: 'conservative O2', comparison: 'liberal O2', outcome: 'survival' },
  pico_ko: { population: '성인', intervention: '보존적 산소', comparison: '자유 산소', outcome: '생존' },
  secondaryOutcomes: ['ICU LOS'],
  secondaryOutcomes_ko: ['중환자실 재원기간'],
  statGlossary: [{ term: 'RR', explanation_ko: '상대위험도' }],
  limitations_ko: '단일 국가 위주',
  clinicalTakeaway_ko: '엄격한 산소 제한은 이득이 없다',
  practiceChange: ['Do not restrict O2'],
  practiceChange_ko: ['산소를 제한하지 말 것'],
  sources: [{ label: 'NEJM', url: 'https://nejm.org/x' }],
  paper: { title: 'Conservative Oxygen', journal: 'NEJM', pmid: '40001', doi: '10.1/x' },
};

const guideline = {
  title_ko: '패혈증 지침 2026',
  org: 'SCCM',
  summary: ['Start antibiotics within 1h'],
  summary_ko: ['1시간 내 항생제 투여'],
  keyChanges: [{ topic: '항생제 시점', detail: 'was 3h, now 1h', detail_ko: '3시간에서 1시간으로' }],
  practiceImpact_ko: '초기 대응 속도가 중요해진다',
  paper: { title: 'Sepsis Guideline 2026', journal: 'CCM', pmid: '40002' },
};

const review = {
  pmid: '40003',
  card: {
    title_ko: '자원제한 환경의 패혈증 관리',
    coverage: 'abstract-only',
    sections: [{ heading_ko: '서론', body_ko: '첫 문단\n\n둘째 문단' }],
    practiceImpact_ko: '자원이 없을 때의 우선순위',
    paper: { title: 'Sepsis in resource-limited settings', journal: 'ICM', pmid: '40003' },
  },
};

const base = { dateStr: '2026-08-17', pagesUrl: 'https://njell85-spec.github.io/trend-review/' };

test('세 트랙이 다 있으면 세 절이 다 들어간다', () => {
  const out = buildDailyDigest({ ...base, papers: [paper], guideline, review });
  assert.match(out, /^# Trend Review — 2026-08-17/);
  assert.match(out, /## 📄 논문 — 심정지 후 보존적 산소요법/);
  assert.match(out, /## 📋 가이드라인 — 패혈증 지침 2026/);
  assert.match(out, /## 📰 리뷰 아티클 — 자원제한 환경의 패혈증 관리/);
  assert.match(out, /분석 3건/);
  assert.ok(out.includes('https://njell85-spec.github.io/trend-review/'));
});

// ★ "동일내용" 계약 — 카드가 그리는 축이 빠지면 적색. 축을 줄이면 첨부와 화면이 갈린다.
test('★ 논문 절이 카드의 축을 전부 담는다', () => {
  const out = buildDailyDigest({ ...base, papers: [paper] });
  for (const axis of ['WHY IT MATTERS', 'PICO', '2차 결과', '통계 용어', '제한점', '임상 결론', 'Practice Change']) {
    assert.ok(out.includes(`### ${axis}`), `축 누락: ${axis}`);
  }
  assert.match(out, /\*\*P\*\* — 성인/);
  assert.match(out, /\*\*O\*\* — 생존/);
  assert.match(out, /중환자실 재원기간/);
  assert.match(out, /\*\*RR\*\* — 상대위험도/);
  assert.match(out, /산소를 제한하지 말 것/);
  assert.match(out, /\[PubMed 40001\]\(https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/40001\/\)/);
});

test('★ 가이드라인 절이 핵심 권고·변경점·임팩트를 담는다', () => {
  const out = buildDailyDigest({ ...base, guideline });
  assert.ok(out.includes('### 핵심 권고'));
  assert.ok(out.includes('### 이전 판 대비 변경점'));
  assert.ok(out.includes('### 임상 임팩트'));
  assert.match(out, /1시간 내 항생제 투여/);
  assert.match(out, /3시간에서 1시간으로/);
});

// 리뷰는 요약이 아니라 번역이다 (PR #125) — 축이 다르다.
test('★ 리뷰 절은 본문 번역·확보 수준·임상 적용을 담고 "핵심 권고"가 없다', () => {
  const out = buildDailyDigest({ ...base, review });
  assert.ok(out.includes('### 본문 번역'));
  assert.ok(out.includes('#### 서론'));
  assert.match(out, /첫 문단/);
  assert.match(out, /둘째 문단/);
  assert.ok(out.includes('### 임상 적용'));
  assert.match(out, /초록 범위만 옮겼습니다/, 'coverage 안내가 없다 — 화면은 정직하게 말하는데 첨부가 숨긴다');
  assert.ok(!out.includes('### 핵심 권고'), '리뷰에 요약 축이 붙었다');
});

test('발행이 없으면 그렇게 적고 던지지 않는다', () => {
  const out = buildDailyDigest({ ...base });
  assert.match(out, /발행된 분석이 없습니다/);
});

test('필드가 통째로 비어도 던지지 않는다', () => {
  assert.doesNotThrow(() => buildDailyDigest({ dateStr: '2026-08-17', papers: [{}], guideline: {}, review: {} }));
  assert.doesNotThrow(() => buildDailyDigest({}));
});

// 외부/LLM 텍스트가 문서 구조를 새로 열지 못하게 (docBuilder esc() 와 같은 취지)
test('★ 제목 속 Markdown 문법 문자는 리터럴이 된다', () => {
  const out = buildDailyDigest({
    ...base,
    papers: [{ title_ko: '# 가짜제목 *강조* [링크](x)', paper: { pmid: '1' } }],
  });
  assert.ok(!/\n# 가짜제목/.test(out), '제목이 새 h1 을 열었다');
  assert.match(out, /\\#|\\\*/);
});

test('제목의 줄바꿈이 절 구조를 깨지 않는다', () => {
  const out = buildDailyDigest({ ...base, papers: [{ title_ko: '앞\n## 가짜절\n뒤', paper: { pmid: '1' } }] });
  const h2 = out.split('\n').filter((l) => l.startsWith('## '));
  assert.equal(h2.length, 1, `h2 가 ${h2.length}개 — 제목 줄바꿈이 절을 열었다`);
});

test('md(): 리스트 여는 하이픈도 리터럴', () => {
  assert.equal(md('- 항목'), '\\- 항목');
});

test('파일명: 날짜 형식만 그대로, 아니면 안전한 기본값', () => {
  assert.equal(dailyDigestFilename('2026-08-17'), 'trend-review-2026-08-17.md');
  assert.equal(dailyDigestFilename('../../etc/passwd'), 'trend-review-daily.md');
  assert.equal(dailyDigestFilename(''), 'trend-review-daily.md');
});

// ★★ 이 저장소의 최다 반복 함정 — "모듈은 옳은데 아무도 안 부른다".
//    trackDigest.js 와 sendDocument 가 정확히 그 상태로 두 주 있었다.
//    배선을 지우면 적색이 되게 못 박는다.
test('★★ 진입점이 실제로 md 를 만들어 sendDocument 로 보낸다 (배선 계약)', () => {
  const src = readFileSync(new URL('../github-actions-daily.mjs', import.meta.url), 'utf8');
  assert.match(src, /buildDailyDigest/, '진입점이 buildDailyDigest 를 안 부른다');
  assert.match(src, /dailyDigestFilename/, '진입점이 dailyDigestFilename 을 안 부른다');
  assert.match(src, /sendDocument\s*\(/, '진입점이 sendDocument 를 안 부른다');
  // 논문 0편 조기 종료 앞에서도 첨부를 시도해야 한다 — 그날 나간 것이 그 둘뿐인 날이 있다.
  const early = src.indexOf('if (!papers.length)');
  const exit = src.indexOf('process.exit(0)', early);
  assert.ok(early > 0 && exit > early);
  assert.match(src.slice(early, exit), /sendDailyDigest\(\)/,
    '논문 0편 경로에서 md 첨부를 안 보낸다 — 가이드라인·리뷰만 나간 날 알림이 통째로 없다');
});

test('★★ 오케스트레이터가 결과에 guideline·review 를 싣는다 (배선 계약)', () => {
  const src = readFileSync(new URL('../src/orchestrator/TrendReviewOrchestrator.js', import.meta.url), 'utf8');
  // 두 경로(정상 · 논문 쉬는 날) 모두에서 실려야 한다.
  const hits = src.match(/guideline:\s*guidelineCard\s*\?\?\s*null/g) ?? [];
  assert.ok(hits.length >= 2, `guideline 을 결과에 싣는 자리가 ${hits.length}곳 — 두 경로 다 필요하다`);
  const rev = src.match(/review:\s*reviewItem\s*\?\?\s*null/g) ?? [];
  assert.ok(rev.length >= 2, `review 를 결과에 싣는 자리가 ${rev.length}곳 — 두 경로 다 필요하다`);
});
