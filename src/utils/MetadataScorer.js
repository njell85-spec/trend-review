/**
 * MetadataScorer — 결정적(deterministic) 논문 스코어러.
 *
 * LLM 을 전혀 쓰지 않고 PubMed 메타데이터만으로 1–10 점을 매긴다.
 *   · 이유: Claude Code CLI(구독)의 안전필터가 "의학 초록 대량 채점"을 거부(AUP refusal)해서
 *     무료·무인 GitHub Actions 자동화에서 LLM 배치 스코어링이 불가능하다.
 *   · 대신 저널 등급 · 연구 설계(PublicationType) · 표본수 · 최신성 · EM/CCM 적합도를
 *     가중 합산한다. 모두 PubMed 가 제공하는 구조화된 사실이라 환각(hallucination)이 없고,
 *     빠르고, 재현 가능하며, 이유(rationale)를 사람이 검증할 수 있다.
 *
 * 출력 형태는 기존 LLM 스코어러와 동일한 계약을 지킨다:
 *   { pmid, score, rationale, studyType }
 *
 * Opus 는 이 단계 이후 "선정된 1편"의 PICO 심층분석에만 쓴다.
 */

// ── 저널 등급 (부분 문자열 매칭, 소문자) ────────────────────────────────────────
// tier1: 최상위 종합 저널 / tier2: EM·CCM 대표 저널 / tier3: 견실한 전문 저널
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
// PublicationType 문자열(소문자) 부분매칭. 위에서부터 우선순위(강한 설계 우선).
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

// ── EM/CCM 핵심 도메인 어휘 (제목 + MeSH + 키워드에서 매칭) ──────────────────────
const DOMAIN_LEXICON = [
  'sepsis', 'septic', 'resuscitation', 'cardiac arrest', 'cardiopulmonary',
  'shock', 'airway', 'intubation', 'mechanical ventilation', 'ventilator',
  'ards', 'acute respiratory distress', 'trauma', 'hemorrhage', 'haemorrhage',
  'stroke', 'toxicology', 'overdose', 'poisoning', 'anaphylaxis',
  'pulmonary embolism', 'myocardial infarction', 'acute coronary',
  'vasopressor', 'norepinephrine', 'fluid', 'lactate', 'triage',
  'emergency', 'critical care', 'intensive care', 'icu', 'critically ill',
  'traumatic brain', 'status epilepticus', 'acute kidney', 'delirium',
];

export class MetadataScorer {
  constructor(options = {}) {
    // 참조 시점(최신성 계산 기준). 기본은 실행 시각.
    this.now = options.now ? new Date(options.now) : new Date();
  }

  // ── public: LLM scorePapers 와 동일 시그니처 ──────────────────────────────
  scorePapers(papers) {
    return papers.map((p) => this.scoreOne(p));
  }

  scoreOne(paper) {
    const design = this._designScore(paper);       // 0–4.0
    const journal = this._journalScore(paper);     // 0–2.5
    const recency = this._recencyScore(paper);     // 0–1.5
    const sample = this._sampleScore(paper);       // 0–1.0  (+ n 추정치)
    const domain = this._domainScore(paper);       // 0–1.0
    const penalty = this._negativePenalty(paper);  // ≤ 0

    let raw = design.score + journal.score + recency.score + sample.score + domain.score + penalty.value;
    const score = Math.max(1, Math.min(10, Math.round(raw * 10) / 10));

    return {
      pmid: paper.pmid,
      score,
      studyType: design.label,
      rationale: this._rationale({ design, journal, recency, sample, domain, penalty }),
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
    // PublicationType 이 비었거나 매칭 없음 → 초록 제목에서 RCT 힌트라도 탐색
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
    if (JOURNAL_TIERS.tier1.some((n) => j.includes(n))) return { score: 2.5, tier: 1 };
    if (JOURNAL_TIERS.tier2.some((n) => j.includes(n))) return { score: 2.0, tier: 2 };
    if (JOURNAL_TIERS.tier3.some((n) => j.includes(n))) return { score: 1.3, tier: 3 };
    return { score: 0.6, tier: 0 };
  }

  // ── 최신성 (발행일 기준) ─────────────────────────────────────────────────────
  _recencyScore(paper) {
    const days = this._ageDays(paper.pubDate);
    if (days == null) return { score: 0.7, days: null };      // 불명 → 중립
    if (days <= 30)  return { score: 1.5, days };
    if (days <= 90)  return { score: 1.2, days };
    if (days <= 180) return { score: 0.9, days };
    if (days <= 365) return { score: 0.5, days };
    return { score: 0.2, days };
  }

  _ageDays(pubDate) {
    if (!pubDate) return null;
    // pubDate 형태: "2026-03", "2026-Mar-15", "2026", "2026-03-15" 등
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
    const day = parts[2] && Number(parts[2]) ? Number(parts[2]) : 15; // 일 없으면 월중
    const dt = new Date(Date.UTC(year, month, day));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // ── 표본수 (초록에서 N 추정) ─────────────────────────────────────────────────
  _sampleScore(paper) {
    const n = this._extractSampleSize(paper.abstract ?? '');
    if (n == null) return { score: 0.3, n: null };
    if (n >= 1000) return { score: 1.0, n };
    if (n >= 300)  return { score: 0.7, n };
    if (n >= 100)  return { score: 0.45, n };
    if (n >= 30)   return { score: 0.25, n };
    return { score: 0.1, n };
  }

  _extractSampleSize(abstract) {
    if (!abstract) return null;
    const text = abstract.replace(/,(?=\d{3}\b)/g, ''); // "1,200" → "1200"
    const candidates = [];
    // "N=544", "n = 1200", "enrolled 544 patients", "544 patients", "included 1200 ..."
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
    return Math.max(...candidates); // 총 표본에 가장 근접한 최댓값 채택
  }

  // ── EM/CCM 도메인 적합도 ─────────────────────────────────────────────────────
  _domainScore(paper) {
    const hay = [
      paper.title ?? '',
      ...(paper.meshTerms ?? []),
      ...(paper.keywords ?? []),
    ].join(' ').toLowerCase();
    const hits = new Set();
    for (const term of DOMAIN_LEXICON) {
      if (hay.includes(term)) hits.add(term);
    }
    const n = hits.size;
    const score = n >= 3 ? 1.0 : n === 2 ? 0.7 : n === 1 ? 0.4 : 0;
    return { score, hits: [...hits].slice(0, 4) };
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
  _rationale({ design, journal, recency, sample, domain, penalty }) {
    const parts = [];
    parts.push(design.label !== 'Other' ? design.label : '설계 미상');
    const tierName = { 1: '최상위 저널', 2: 'EM·CCM 대표 저널', 3: '전문 저널', 0: '일반 저널' }[journal.tier];
    parts.push(tierName);
    if (recency.days != null) {
      parts.push(recency.days <= 30 ? '최근 30일' : recency.days <= 90 ? '최근 3개월' : recency.days <= 180 ? '6개월 내' : '1년 내');
    }
    if (sample.n != null) parts.push(`N≈${sample.n}`);
    if (domain.hits.length) parts.push(domain.hits.join('·'));
    let s = parts.join(' · ');
    if (penalty.reasons.length) s += ` (감점: ${penalty.reasons.join(', ')})`;
    return s;
  }
}
