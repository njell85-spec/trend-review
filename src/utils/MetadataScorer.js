/**
 * MetadataScorer — 결정적(deterministic) 논문 스코어러 (2축 모델).
 *
 * LLM 을 전혀 쓰지 않고 PubMed 메타데이터만으로 점수를 매긴다.
 *   · 이유: Claude Code CLI(구독)의 안전필터가 "의학 초록 대량 채점"을 거부(AUP refusal)해서
 *     무료·무인 GitHub Actions 자동화에서 LLM 배치 스코어링이 불가능하다.
 *   · 모두 PubMed 가 제공하는 구조화된 사실이라 환각(hallucination)이 없고, 재현 가능하며,
 *     이유(rationale)를 사람이 검증할 수 있다.
 *
 * 두 개의 축으로 나눈다 (PeterJ 요청: "좋은 논문 + 나에게 가장 적절한 논문"):
 *   ① 질(Quality)     — 연구 설계 · 저널 등급 · 표본수 · 최신성        (0~10)
 *   ② 적합도(Relevance) — config/interests.json 관심 프로파일 매칭        (0~10)
 * 최종점수 = 질 × (floor + lift × 적합도01) + 감점, [1,10] 로 클램프.
 *   · 적합도는 질을 최대 +30% 증폭 → PeterJ 관심사에 맞는 논문이 우선.
 *   · rawScore(풀 정밀도)를 별도 보관해 정렬 시 동점(tie)을 안정적으로 깬다.
 *
 * 출력 계약 (기존 LLM 스코어러와 호환):
 *   { pmid, score, rawScore, qualityScore, relevanceScore, studyType, rationale, matchedInterests }
 *
 * Opus 는 이 단계 이후 "선정된 1편"의 PICO 심층분석에만 쓴다.
 */
import { readFileSync } from 'fs';

// ── 저널 등급 (부분 문자열 매칭, 소문자) ────────────────────────────────────────
const JOURNAL_TIERS = {
  tier1: [
    'n engl j med', 'new england journal of medicine',
    'lancet', 'jama', 'bmj', 'nature medicine', 'nature',
  ],
  tier2: [
    'annals of emergency medicine', 'ann emerg med',
    'critical care medicine', 'crit care med',
    'intensive care medicine', 'intensive care med',
    'american journal of respiratory and critical care', 'am j respir crit care',
    'chest', 'circulation', 'resuscitation',
    'jama internal medicine', 'jama intern med',
    'jama network open', 'jama neurology', 'jama surgery', 'jama cardiology',
    'lancet respiratory', 'lancet neurology', 'european heart journal',
    'blood', 'gastroenterology', 'stroke',
  ],
  tier3: [
    'critical care', 'annals of intensive care', 'ann intensive care',
    'shock', 'academic emergency medicine', 'acad emerg med',
    'emergency medicine journal', 'emerg med j',
    'american journal of emergency medicine', 'am j emerg med',
    'canadian journal of emergency', 'cjem',
    'scandinavian journal of trauma', 'annals of intensive',
    'journal of critical care', 'j crit care',
    'european journal of emergency medicine', 'eur j emerg med',
    'prehospital emergency care', 'journal of thrombosis',
    'thorax', 'anesthesiology', 'british journal of anaesthesia',
    'journal of trauma', 'j trauma',
  ],
};

// ── 연구 설계 → (점수, 표준 라벨) ──────────────────────────────────────────────
const DESIGN_RULES = [
  { match: ['meta-analysis'],                     score: 4.0, label: 'Meta-analysis' },
  { match: ['systematic review'],                 score: 3.7, label: 'Systematic Review' },
  { match: ['randomized controlled trial'],       score: 4.0, label: 'RCT' },
  { match: ['clinical trial, phase iii'],         score: 3.6, label: 'RCT' },
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

// config 파일이 없을 때의 임베디드 기본 프로파일 (일반 EM/CCM).
const DEFAULT_PROFILE = {
  topicGroups: {
    em_ccm: {
      label: '응급·중환자',
      weight: 1.0,
      terms: ['sepsis', 'resuscitation', 'cardiac arrest', 'airway', 'shock',
              'mechanical ventilation', 'ards', 'emergency', 'critical care', 'intensive care'],
    },
  },
  blend: { relevanceFloor: 0.7, relevanceLift: 0.3 },
};

export class MetadataScorer {
  constructor(options = {}) {
    // 참조 시점(최신성 계산 기준). 기본은 실행 시각.
    this.now = options.now ? new Date(options.now) : new Date();
    this.profile = options.profile ?? this._loadProfile();
    this.blend = { relevanceFloor: 0.7, relevanceLift: 0.3, ...(this.profile.blend ?? {}) };
  }

  _loadProfile() {
    try {
      const url = new URL('../../config/interests.json', import.meta.url);
      const raw = readFileSync(url, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.topicGroups && Object.keys(parsed.topicGroups).length) return parsed;
    } catch { /* fall through to default */ }
    return DEFAULT_PROFILE;
  }

  // ── public: LLM scorePapers 와 동일 시그니처 ──────────────────────────────
  scorePapers(papers) {
    return papers.map((p) => this.scoreOne(p));
  }

  scoreOne(paper) {
    const design = this._designScore(paper);       // 0–4.0
    const journal = this._journalScore(paper);     // 0–3.0
    const recency = this._recencyScore(paper);     // 0–1.5
    const sample = this._sampleScore(paper);       // 0–1.5  (+ n 추정치)
    const penalty = this._negativePenalty(paper);  // ≤ 0

    // ① 질 축 (0~10)
    const quality = Math.max(0, Math.min(10,
      design.score + journal.score + recency.score + sample.score));

    // ② 적합도 축 (0~1, 표시용 0~10)
    const rel = this._relevance(paper);             // { rel01, groups }

    // 최종점수: 질을 적합도로 증폭 + 감점
    const { relevanceFloor: floor, relevanceLift: lift } = this.blend;
    const rawScore = quality * (floor + lift * rel.rel01) + penalty.value;
    const score = Math.max(1, Math.min(10, Math.round(rawScore * 10) / 10));

    return {
      pmid: paper.pmid,
      score,
      rawScore: Math.max(1, Math.min(10, rawScore)),   // 정렬용 풀 정밀도
      qualityScore: Math.round(quality * 10) / 10,
      relevanceScore: Math.round(rel.rel01 * 100) / 10, // 0~10
      studyType: design.label,
      matchedInterests: rel.groups,
      rationale: this._rationale({ design, journal, recency, sample, penalty, quality, rel }),
    };
  }

  // ── 연구 설계 ──────────────────────────────────────────────────────────────
  _designScore(paper) {
    const types = (paper.publicationTypes ?? []).map((t) => String(t).toLowerCase());
    const hay = types.join(' | ');
    for (const rule of DESIGN_RULES) {
      if (rule.match.some((m) => hay.includes(m))) {
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

  // ── 저널 등급 ──────────────────────────────────────────────────────────────
  _journalScore(paper) {
    const j = String(paper.journal ?? '').toLowerCase();
    if (JOURNAL_TIERS.tier1.some((n) => j.includes(n))) return { score: 3.0, tier: 1 };
    if (JOURNAL_TIERS.tier2.some((n) => j.includes(n))) return { score: 2.2, tier: 2 };
    if (JOURNAL_TIERS.tier3.some((n) => j.includes(n))) return { score: 1.4, tier: 3 };
    return { score: 0.6, tier: 0 };
  }

  // ── 최신성 (발행일 기준) ─────────────────────────────────────────────────────
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

  // ── 표본수 (초록에서 N 추정) ─────────────────────────────────────────────────
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

  // ── ② 적합도: 관심 프로파일 매칭 (0~1) ────────────────────────────────────────
  _relevance(paper) {
    const title = String(paper.title ?? '').toLowerCase();
    const meta = [...(paper.meshTerms ?? []), ...(paper.keywords ?? []),
                  String(paper.abstract ?? '').slice(0, 600)].join(' ').toLowerCase();

    const scored = [];
    for (const [key, g] of Object.entries(this.profile.topicGroups ?? {})) {
      const w = Number(g.weight ?? 0);
      let titleHits = 0, metaHits = 0;
      for (const term of g.terms ?? []) {
        const t = String(term).toLowerCase();
        if (title.includes(t)) titleHits++;
        else if (meta.includes(t)) metaHits++;
      }
      // 그룹 신호(0~1): 제목 매칭이 메타보다 크게 반영, 포화(saturating).
      const signal = Math.min(1, titleHits * 0.6 + metaHits * 0.25);
      if (signal > 0) scored.push({ key, label: g.label ?? key, w, groupScore: w * signal });
    }
    scored.sort((a, b) => b.groupScore - a.groupScore);

    // 최상위 그룹 + 2순위 소폭 보너스 → 0~1 클램프
    const best = scored[0]?.groupScore ?? 0;
    const second = scored[1]?.groupScore ?? 0;
    const rel01 = Math.max(0, Math.min(1, best + 0.15 * second));
    return { rel01, groups: scored.slice(0, 3).map((s) => s.label) };
  }

  // ── 감점 (사설·논평·동물·시험관 등) ───────────────────────────────────────────
  _negativePenalty(paper) {
    const types = (paper.publicationTypes ?? []).map((t) => String(t).toLowerCase()).join(' | ');
    const reasons = [];
    let value = 0;
    if (NEGATIVE_TYPES.some((t) => types.includes(t))) { value -= 3.0; reasons.push('사설/논평/서한'); }

    const hay = [paper.title ?? '', ...(paper.meshTerms ?? [])].join(' ').toLowerCase();
    if (/\b(mice|mouse|rats?|murine|in vitro|zebrafish|porcine|canine)\b/.test(hay) &&
        !/\bhuman\b/.test(hay)) { value -= 2.0; reasons.push('전임상(동물/시험관)'); }
    if (/\bstudy protocol\b|\bprotocol for a\b|\brationale and design\b/.test(hay)) {
      value -= 1.5; reasons.push('프로토콜(결과 없음)');
    }
    return { value, reasons };
  }

  // ── 사람이 읽는 근거 문장 (한국어) ────────────────────────────────────────────
  _rationale({ design, journal, recency, sample, penalty, quality, rel }) {
    const parts = [];
    parts.push(`질 ${Math.round(quality * 10) / 10}`);
    parts.push(`적합도 ${Math.round(rel.rel01 * 100) / 10}`);
    parts.push(design.label !== 'Other' ? design.label : '설계 미상');
    const tierName = { 1: '최상위 저널', 2: 'EM·CCM 대표 저널', 3: '전문 저널', 0: '일반 저널' }[journal.tier];
    parts.push(tierName);
    if (recency.days != null) {
      parts.push(recency.days <= 30 ? '최근 30일' : recency.days <= 90 ? '최근 3개월' : recency.days <= 180 ? '6개월 내' : '1년 내');
    }
    if (sample.n != null) parts.push(`N≈${sample.n}`);
    if (rel.groups.length) parts.push(rel.groups.join('·'));
    let s = parts.join(' · ');
    if (penalty.reasons.length) s += ` (감점: ${penalty.reasons.join(', ')})`;
    return s;
  }
}
