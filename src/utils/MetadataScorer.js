/**
 * MetadataScorer — 결정적(deterministic) 논문 스코어러.
 *
 * LLM 을 전혀 쓰지 않고 PubMed 메타데이터만으로 점수를 매긴다.
 *   · 이유: Claude Code CLI(구독) 안전필터의 배치 채점 거부(AUP)와 세션 한도(429)를 회피 —
 *     무료·무인 GitHub Actions 자동화에서 안정적으로 매일 돈다. 환각 없음·재현 가능·근거 검증 가능.
 *   · LLM(Opus) 은 이 단계 이후 "선정 상위 K편"의 재순위·PICO 심층분석에만 쓴다.
 *
 * 선정 우선순위 (PeterJ 확정 2026-07-10): ① 관심주제 부합  ② 저명 저널 — 이 둘이 우선.
 *   → 최종점수에서 주제·저널이 지배적(각 0~4)이고 설계·최신성·표본은 보조(합 ~3).
 *   → 관심주제 0매칭이면 topicGatePenalty 로 사실상 배제(비관심 논문이 저명저널이라도 안 뜬다).
 *   관심 프로파일 = config/interests.json, 저널 등급 = config/journals.json (숫자만 고쳐 튜닝).
 *
 * 출력 계약 (기존 소비자와 호환):
 *   { pmid, score, rawScore, qualityScore, relevanceScore, studyType, rationale, matchedInterests }
 */
import { readFileSync } from 'fs';

// ── 연구 설계 → (점수, 표준 라벨) — 보조 신호(가중 축소되어 반영) ────────────────
const DESIGN_RULES = [
  { match: ['meta-analysis'],                     score: 4.0, label: 'Meta-analysis' },
  { match: ['systematic review'],                 score: 3.7, label: 'Systematic Review' },
  { match: ['randomized controlled trial'],       score: 4.0, label: 'RCT' },
  { match: ['clinical trial, phase iii'],         score: 3.6, label: 'RCT' },
  { match: ['clinical trial, phase iv'],          score: 3.2, label: 'Clinical Trial' },
  { match: ['practice guideline', 'guideline'],   score: 3.3, label: 'Guidelines' },
  { match: ['clinical trial'],                    score: 3.0, label: 'Clinical Trial' },
  { match: ['multicenter study'],                 score: 2.6, label: 'Observational' },
  { match: ['observational study', 'comparative study', 'cohort'],
                                                  score: 2.3, label: 'Observational' },
  { match: ['review'],                            score: 1.7, label: 'Review' },
  { match: ['case reports'],                      score: 0.6, label: 'Case Series' },
];

// 신뢰도를 떨어뜨리는 유형 — 강한 감점(임상 적용성 낮음)
const NEGATIVE_TYPES = [
  'editorial', 'comment', 'letter', 'news', 'biography',
  'retraction', 'published erratum', 'historical article',
];

// 컴포넌트 스케일 — 주제·저널(각 0~4)이 지배적이 되도록 보조 신호를 축소한다.
// v2 (2026-08-10): 설계 축을 0~2.0 으로 올리고 **최신성·표본 축은 삭제**했다.
//   · 최신성: 수집이 최신순 300편이라 실효창이 ~2주 — 사실상 상수였고, 게다가
//     호(issue) 발행일을 읽어 07월 전자공개분을 "1년+"로 오판했다(F6).
//   · 표본: 초록의 배경 문장 인구수를 표본으로 읽었다(실측 `N≈1704632`, F5).
//   두 축이 빠진 자리를 설계 축이 받는다 — 보조 축 합은 종전 ~3.0 → 2.0 으로 오히려 준다.
const DESIGN_SCALE = 0.5;        // design 0~4 → 0~2.0
const DESIGN_CAP = 2.0;
const RELEVANCE_SPAN = 4.0;      // rel01(0~1) → 0~4

// 주제 축 탈포화 (F3) — 종전 `titleHits * 0.6` 은 제목 2히트로 만점이었다.
// 체감가중이라 4히트에서 1.00 에 닿는다. MeSH·초록은 보조(최대 0.24).
const TITLE_HIT_WEIGHTS = [0.50, 0.25, 0.15, 0.10];
const META_HIT_WEIGHT = 0.08;
const META_HIT_CAP = 3;

// 서술 리뷰는 **최상위 종합지에서만** 대접한다 (PeterJ 확정 ① 2026-08-06).
// 그 외 저널의 서술 종설은 침상 가치가 낮은데, 종전에는 설계 1.7 로 관찰연구에
// 육박해 상위 20 의 6편을 차지했다(2026-08-10 실측).
const REVIEW_FLAGSHIP_TIERS = ['최상위 종합지', '최상위'];
const REVIEW_SCORE_FLAGSHIP = 3.2;
const REVIEW_SCORE_OTHER = 0.7;

// 저널 배제 패턴 — **코드에 내장된 바닥**(PeterJ 지시 2026-08-10).
// ★ config 에만 두면 `journals.json` 이 깨졌을 때 `_loadJson` 이 조용히 기본값으로
//   떨어지면서 **배제가 통째로 꺼진 채 로그도 없이** 데일리가 돈다 — 이 개편이 막으려던
//   바로 그 실패다. 그래서 코드가 바닥을 들고, config 는 `patterns` 로 **더하기만** 한다.
//   되살리기는 config `exclude.allow` 로 한다(폰에서 한 줄 추가 = 그 저널 부활).
const EXCLUDE_BUILTIN = [
  "nursing",
  "nurse",
  " nurs ",
  "midwifery",
  "nutrition",
  "nutrients",
  "dietet",
  "parenteral and enteral",
  "rehabilitation",
  "physical therapy",
  "physiotherapy",
  "occupational therapy",
  "medical education",
  "education online",
  "medical teacher",
  "health policy",
  "health services research",
  "health economics",
  "veterinary",
  "dental",
  "dentistry",
  "oral health",
  "acupuncture",
  "herbal",
  "complementary",
  "alternative medicine",
  "ethics",
  "nursing ethics",
  "informatics",
  "american journal of critical care",
  "heart & lung",
  "intensive and critical care nurs"
];

// config 파일이 없을 때의 임베디드 기본값 (일반 EM/CCM).
const DEFAULT_PROFILE = {
  topicGroups: {
    em_ccm: {
      label: '응급·중환자',
      weight: 1.0,
      terms: ['sepsis', 'resuscitation', 'cardiac arrest', 'airway', 'shock',
              'mechanical ventilation', 'ards', 'stroke', 'trauma', 'intensive care'],
    },
  },
  deprioritize: { groups: {} },
  scoring: { journalWeight: 1.0, relevanceWeight: 1.0, topicGatePenalty: -5.0 },
};

const DEFAULT_JOURNALS = {
  tiers: {
    top_general: { label: '최상위 종합지', score: 4.0,
      exact: ['jama', 'bmj', 'lancet', 'nature'],
      includes: ['new england journal', 'nature medicine'] },
    em_ccm_flagship: { label: 'EM·CCM 대표지', score: 3.2,
      includes: ['critical care medicine', 'intensive care medicine', 'resuscitation',
                 'annals of emergency medicine', 'chest', 'circulation', 'stroke'] },
    specialty: { label: '전문 저널', score: 2.0,
      includes: ['american journal of emergency medicine', 'journal of critical care', 'shock'] },
    low: { label: '저명도 낮음', score: -1.0, exact: ['medicine', 'cureus'],
      includes: ['scientific reports', 'bmc ', 'plos one', 'frontiers in', 'heliyon'] },
  },
  default: { label: '그외 SCI', score: 0.8 },
};

export class MetadataScorer {
  constructor(options = {}) {
    // 참조 시점(최신성 계산 기준). 기본은 실행 시각.
    this.now = options.now ? new Date(options.now) : new Date();
    this.profile = options.profile ?? this._loadJson('../../config/interests.json', DEFAULT_PROFILE, (p) => p?.topicGroups);
    this.journals = options.journals ?? this._loadJson('../../config/journals.json', DEFAULT_JOURNALS, (j) => j?.tiers);
    this.scoring = { journalWeight: 1.0, relevanceWeight: 1.0, topicGatePenalty: -5.0, ...(this.profile.scoring ?? {}) };
  }

  _loadJson(relPath, fallback, validate) {
    try {
      const url = new URL(relPath, import.meta.url);
      const parsed = JSON.parse(readFileSync(url, 'utf8'));
      if (validate(parsed)) return parsed;
    } catch { /* fall through to embedded default */ }
    return fallback;
  }

  // ── public: 기존 scorePapers 와 동일 시그니처 ──────────────────────────────
  scorePapers(papers) {
    return papers.map((p) => this.scoreOne(p));
  }

  scoreOne(paper) {
    const jr = this._journalScore(paper);          // -1 ~ 4
    const design = this._designScore(paper, jr);    // 0 ~ 4 (라벨용 · 리뷰는 티어 조건부)
    const recency = this._recencyScore(paper);      // 표시 전용 (점수 미반영)
    const sample = this._sampleScore(paper);        // 표시 전용 (점수 미반영)
    const rel = this._relevance(paper);             // { rel01, groups }
    const pen = this._negativePenalty(paper);       // ≤ 0

    const w = this.scoring;
    // ① 우선순위 축 (지배적): 저널·주제 각 0~4
    const journalPart = w.journalWeight * jr.score;
    const relPart = w.relevanceWeight * (rel.rel01 * RELEVANCE_SPAN);
    // ② 보조 축: 설계뿐 (0~2.0). 최신성·표본은 v2 에서 삭제 — 위 상수 주석 참조.
    const designPart = Math.min(DESIGN_CAP, design.score * DESIGN_SCALE);
    const recencyPart = 0;
    const samplePart = 0;
    // ③ 주제 게이트: 관심 0매칭이면 강한 감점(사실상 배제)
    //    배제 저널은 후보 선정에서 아예 빠지지만(_selectTopPapers), 점수에도 바닥을
    //    깔아 둔다 — 폴백 경로나 진단 리포트에서 위로 올라오지 않게.
    const topicGate = rel.rel01 <= 0 ? Number(w.topicGatePenalty ?? -5) : 0;
    const excludeGate = jr.excluded ? -10 : 0;
    const gate = topicGate + excludeGate;

    // 정렬용 rawScore 는 clamp 하지 않는다(동점 안정 분리 + 게이트 논문 확실히 바닥).
    const rawScore = journalPart + relPart + designPart + recencyPart + samplePart + pen.value + gate;
    const score = Math.max(1, Math.min(10, Math.round(rawScore * 10) / 10));
    const quality = journalPart + designPart + recencyPart + samplePart;

    return {
      pmid: paper.pmid,
      score,
      rawScore,                                        // 풀 정밀·비클램프 (정렬용)
      qualityScore: Math.round(quality * 10) / 10,
      relevanceScore: Math.round(rel.rel01 * 100) / 10, // 0~10 표시
      studyType: design.label,
      designPart: Math.round(designPart * 100) / 100,
      matchedInterests: rel.groups,
      journalTier: jr.tier,
      journalExcluded: jr.excluded === true,
      gated: gate < 0,
      rationale: this._rationale({ jr, design, recency, sample, pen, rel, topicGate, excludeGate }),
    };
  }

  // ── 저널 등급 (config/journals.json) ─────────────────────────────────────
  // 판정 순서: top → flagship → specialty → low → default.
  // exact=저널명 정확일치(자매지 오매칭 방지: 'jama' vs 'jama network open'),
  // includes=부분일치. 'medicine' 같은 범용명은 low.exact 로만 잡아 'critical care medicine' 오탐 방지.
  // ── 저널 배제 (PeterJ 지시 2026-08-10 — 감점이 아니라 배제) ──────────────────
  // ★ 티어 판정보다 **먼저** 걸러야 한다. 대표지 티어가 `'critical care'` 맨몸
  //   부분일치라, 이 검사가 없으면 "Intensive & critical care nursing" 같은 간호지가
  //   3.2점(대표지)을 받는다 — 실제로 2026-08-09·10 이틀 연속 그렇게 1위로 발행됐다.
  //   저널명이 비면 배제하지 않는다(메타데이터 결손으로 좋은 논문을 잃지 않는다).
  isExcludedJournal(paper) {
    const j = String(paper?.journal ?? '').toLowerCase().trim();
    if (!j) return false;
    const allow = this.journals.exclude?.allow ?? [];
    if (allow.some((t) => j.includes(String(t).toLowerCase()))) return false;
    const pats = [...EXCLUDE_BUILTIN, ...(this.journals.exclude?.patterns ?? [])];
    return pats.some((t) => j.includes(String(t).toLowerCase()));
  }

  _journalScore(paper) {
    const j = String(paper.journal ?? '').toLowerCase().trim();
    if (this.isExcludedJournal(paper)) {
      return { score: this.journals.tiers?.low?.score ?? -1.0, tier: this.journals.exclude?.label ?? '배제 저널', excluded: true };
    }
    const T = this.journals.tiers ?? {};
    const exact = (arr) => (arr ?? []).some((n) => j === n);
    const inc = (arr) => j.length > 0 && (arr ?? []).some((n) => j.includes(n));

    if (T.top_general && (exact(T.top_general.exact) || inc(T.top_general.includes)))
      return { score: T.top_general.score, tier: T.top_general.label ?? '최상위' };
    if (T.em_ccm_flagship && inc(T.em_ccm_flagship.includes))
      return { score: T.em_ccm_flagship.score, tier: T.em_ccm_flagship.label ?? '대표지' };
    if (T.specialty && inc(T.specialty.includes))
      return { score: T.specialty.score, tier: T.specialty.label ?? '전문지' };
    if (T.low && (exact(T.low.exact) || inc(T.low.includes)))
      return { score: T.low.score, tier: T.low.label ?? '저명도 낮음' };
    return { score: this.journals.default?.score ?? 0.8, tier: this.journals.default?.label ?? '그외 SCI' };
  }

  // ── 연구 설계 ──────────────────────────────────────────────────────────────
  _designScore(paper, jr = null) {
    const types = (paper.publicationTypes ?? []).map((t) => String(t).toLowerCase());
    const hay = types.join(' | ');
    for (const rule of DESIGN_RULES) {
      if (rule.match.some((m) => hay.includes(m))) {
        // 서술 리뷰만 티어 조건부 (PeterJ 확정 ①). 체계적 문헌고찰·메타분석은
        // 별도 라벨이라 여기 걸리지 않는다 — 근거 종합이지 종설이 아니다.
        if (rule.label === 'Review') {
          const flagship = REVIEW_FLAGSHIP_TIERS.includes(jr?.tier);
          return { score: flagship ? REVIEW_SCORE_FLAGSHIP : REVIEW_SCORE_OTHER, label: 'Review', matched: 'review' };
        }
        return { score: rule.score, label: rule.label, matched: rule.match[0] };
      }
    }
    const title = String(paper.title ?? '').toLowerCase();
    if (/randomi[sz]ed|\brct\b|double-blind|placebo-controlled/.test(title)) {
      return { score: 3.6, label: 'RCT', matched: 'title-rct' };
    }
    if (/meta-analysis/.test(title)) return { score: 3.8, label: 'Meta-analysis', matched: 'title-ma' };
    if (/systematic review/.test(title)) return { score: 3.5, label: 'Systematic Review', matched: 'title-sr' };
    return { score: 1.5, label: 'Other', matched: null };
  }

  // ── 최신성 (발행일 기준, 0~1.5) ──────────────────────────────────────────────
  _recencyScore(paper) {
    const days = this._ageDays(paper.pubDate);
    if (days == null) return { score: 0.7, days: null };
    if (days <= 30)  return { score: 1.5, days };
    if (days <= 90)  return { score: 1.2, days };
    if (days <= 180) return { score: 0.9, days };
    if (days <= 365) return { score: 0.5, days };
    return { score: 0.2, days };
  }

  _ageDays(pubDate) {
    if (!pubDate) return null;
    const d = this._parseDate(pubDate);
    if (!d) return null;
    return Math.max(0, Math.round((this.now - d) / 86_400_000));
  }

  _parseDate(s) {
    const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const parts = String(s).split(/[-\/\s]+/).filter(Boolean);
    if (!parts.length) return null;
    const year = Number(parts[0]);
    if (!Number.isFinite(year) || year < 1900) return null;
    let month = 0;
    if (parts[1]) {
      const m = parts[1].toLowerCase();
      month = MONTHS[m.slice(0, 3)] ?? (Number(parts[1]) ? Number(parts[1]) - 1 : 0);
    }
    const day = parts[2] && Number(parts[2]) ? Number(parts[2]) : 15;
    const dt = new Date(Date.UTC(year, month, day));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // ── 표본수 (초록에서 N 추정, 0~1.5) ─────────────────────────────────────────
  _sampleScore(paper) {
    const n = this._extractSampleSize(paper.abstract ?? '');
    if (n == null) return { score: 0.4, n: null };
    if (n >= 1000) return { score: 1.5, n };
    if (n >= 300)  return { score: 1.1, n };
    if (n >= 100)  return { score: 0.7, n };
    if (n >= 30)   return { score: 0.4, n };
    return { score: 0.15, n };
  }

  _extractSampleSize(abstract) {
    if (!abstract) return null;
    const text = abstract.replace(/,(?=\d{3}\b)/g, '');
    const candidates = [];
    const patterns = [
      /\bN\s*=\s*(\d{2,7})/gi,
      /\b(?:enrolled|randomi[sz]ed|included|recruited|analy[sz]ed)\s+(\d{2,7})\s+(?:patients|participants|subjects|adults|children|cases)/gi,
      /\b(\d{2,7})\s+(?:patients|participants|subjects)\b/gi,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text)) !== null) {
        const v = Number(m[1]);
        if (Number.isFinite(v) && v >= 10 && v <= 10_000_000) candidates.push(v);
      }
    }
    if (!candidates.length) return null;
    return Math.max(...candidates);
  }

  // ── 주제 적합도: 관심 프로파일 매칭 (0~1) ─────────────────────────────────────
  _relevance(paper) {
    const title = String(paper.title ?? '').toLowerCase();
    const meta = [...(paper.meshTerms ?? []), ...(paper.keywords ?? []),
                  String(paper.abstract ?? '').slice(0, 600)].join(' ').toLowerCase();

    const scored = [];
    for (const [key, g] of Object.entries(this.profile.topicGroups ?? {})) {
      const w = Number(g.weight ?? 0);
      // ★ 중복 계수 금지: 'septic shock' 이 걸리면 그 안에 든 'septic' 은 세지 않는다.
      //   config 의 관심어가 서로 겹쳐서(sepsis / septic / septic shock) 한 자리가
      //   3히트로 부풀고, 그것이 주제 포화의 실제 동력이었다.
      //   긴 term 부터 확정하고, 이미 잡힌 term 의 부분문자열은 건너뛴다.
      const terms = [...(g.terms ?? [])].map((t) => String(t).toLowerCase())
        .sort((a, b) => b.length - a.length);
      const hitTitle = [], hitMeta = [];
      for (const t of terms) {
        const covered = (arr) => arr.some((h) => h.includes(t));
        if (title.includes(t)) { if (!covered(hitTitle)) hitTitle.push(t); }
        else if (meta.includes(t)) { if (!covered(hitMeta)) hitMeta.push(t); }
      }
      const titleHits = hitTitle.length, metaHits = hitMeta.length;
      // 탈포화(F3): 히트마다 체감가중. 종전 `titleHits * 0.6` 은 제목 2히트면 만점이라
      // 저널 0.8짜리 논문도 주제 4.0 을 받아 상위권에 올라왔다(2026-08-10 실측 8/20).
      let signal = 0;
      for (let i = 0; i < titleHits; i++) {
        signal += TITLE_HIT_WEIGHTS[i] ?? TITLE_HIT_WEIGHTS[TITLE_HIT_WEIGHTS.length - 1];
      }
      signal += META_HIT_WEIGHT * Math.min(metaHits, META_HIT_CAP);
      signal = Math.min(1, signal);
      if (signal > 0) scored.push({ key, label: g.label ?? key, w, groupScore: w * signal });
    }
    scored.sort((a, b) => b.groupScore - a.groupScore);

    const best = scored[0]?.groupScore ?? 0;
    const second = scored[1]?.groupScore ?? 0;
    const rel01 = Math.max(0, Math.min(1, best + 0.15 * second));
    return { rel01, groups: scored.slice(0, 3).map((s) => s.label) };
  }

  // ── 감점 (사설·논평·동물·프로토콜 + deprioritize 그룹) ────────────────────────
  _negativePenalty(paper) {
    const types = (paper.publicationTypes ?? []).map((t) => String(t).toLowerCase()).join(' | ');
    const reasons = [];
    let value = 0;
    if (NEGATIVE_TYPES.some((t) => types.includes(t))) { value -= 3.0; reasons.push('사설/논평/서한'); }
    if (types.includes('case reports')) { value -= 1.5; reasons.push('증례보고'); }

    const hay = [paper.title ?? '', ...(paper.meshTerms ?? [])].join(' ').toLowerCase();
    if (/\b(mice|mouse|rats?|murine|in vitro|zebrafish|porcine|canine)\b/.test(hay) &&
        !/\bhuman\b/.test(hay)) { value -= 2.0; reasons.push('전임상(동물/시험관)'); }

    // config deprioritize.groups (소아, 비급성·방법론 등) — 매칭 시 감점.
    const depHay = [paper.title ?? '', ...(paper.meshTerms ?? []), ...(paper.keywords ?? []),
                    String(paper.abstract ?? '').slice(0, 400)].join(' ').toLowerCase();
    for (const g of Object.values(this.profile.deprioritize?.groups ?? {})) {
      if (!Number(g.penalty) || !(g.terms?.length)) continue;
      if (g.terms.some((t) => depHay.includes(String(t).toLowerCase()))) {
        value += Number(g.penalty);
        reasons.push(g.label ?? '후순위');
      }
    }
    return { value, reasons };
  }

  // ── 사람이 읽는 근거 문장 (한국어) ────────────────────────────────────────────
  _rationale({ jr, design, recency, sample, pen, rel, topicGate, excludeGate }) {
    const parts = [];
    parts.push(`주제 ${Math.round(rel.rel01 * 100) / 10}`);
    parts.push(jr.tier);
    if (design.label !== 'Other') parts.push(design.label);
    // 최신성·표본은 v2 에서 **점수에 반영되지 않는다**(축 삭제). 참고 표시만 남기되,
    // 근거 문장이 "이 숫자가 점수를 만들었다"고 읽히지 않게 괄호로 구분한다.
    // (특히 표본은 초록 배경 문장의 인구수를 잡는 오추출이 남아 있다 — 실측 N≈1704632)
    if (recency.days != null) {
      const label = recency.days <= 30 ? '최근 30일' : recency.days <= 90 ? '최근 3개월' : recency.days <= 180 ? '6개월 내' : '1년+';
      parts.push(`${label}(참고)`);
    }
    if (sample.n != null) parts.push(`N≈${sample.n}(참고)`);
    if (rel.groups.length) parts.push(rel.groups.join('·'));
    let s = parts.join(' · ');
    if (excludeGate < 0) s += ' (⚠ 배제 저널 — config/journals.json exclude)';
    if (topicGate < 0) s += ' (⚠ 관심주제 무매칭 — 배제)';
    if (pen.reasons.length) s += ` (감점: ${pen.reasons.join(', ')})`;
    return s;
  }
}
