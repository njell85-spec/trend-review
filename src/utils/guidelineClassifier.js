import { matchOrganization } from './guidelineOrgs.js';

function normalized(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NEGATIVE_PATTERNS = [
  ['consensus-process-study', /\b(?:consensus process|consensus methods|developing consensus|consensus exercise|delphi (?:study|survey|round)|agreement among|validation of consensus|adherence to recommendations)\b/],
  ['commentary-or-evaluation', /\b(?:commentary on|editorial|perspective|response to|letter|what is new in|implications of|appraisal of|evaluation of|comparison of guidelines|implementation of guidelines|barriers to guideline|guideline adherence)\b/],
  // ★ 지침 *해설·적용* 논문 — 현행 경로가 실제로 발행한 오탐에서 왔다.
  //   `output/selected_guidelines.json` 의 PMID 42373461
  //   "[The 2026 Surviving Sepsis Campaign guidelines: from evidence updates to practice implementation]."
  //   원 지침이 아니라 그 지침을 **해설하는** 논문인데, 위 두 패턴 어디에도 안 걸려
  //   `guideline` 으로 통과했다(2026-08-15 소급 판정으로 확인).
  //   형식은 "<지침 이름> : <그것을 어떻게 읽고 적용하나>" 다.
  ['guideline-commentary-or-digest', /\b(?:to practice implementation|practice implementation|interpretation of|interpreting the|key points of|highlights of|overview of the|reading the|a summary of|summary of the|update on the)\b/],
];

function publicationTypes(candidate) {
  const raw = candidate.publicationTypes ?? candidate.publicationType ?? [];
  return (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value).split(/[;,]/))
    .map(normalized);
}

function inferDocumentType(title, types) {
  if (types.some((type) => /^(?:practice )?guideline$/.test(type))) return 'guideline';
  if (/\bconsensus statement\b/.test(title)) return 'consensus';
  if (/\bscientific statement\b/.test(title)) return 'scientific-statement';
  if (/\bfocused update\b/.test(title)) return 'focused-update';
  if (/\brecommendations?\b/.test(title)) return 'recommendations';
  if (/\bguidelines?\b/.test(title)) return 'guideline';
  return null;
}

export function classifyGuidelineDocument(candidate, { orgs } = {}) {
  // ★ PeterJ 수동 승인은 자동 필터를 통째로 우회한다 (확정 ⑤-A · 계획서 §6.4).
  //   "PeterJ 가 on-demand 로 URL 을 승인하면 자동 필터를 다시 통과시키지 않고
  //    manualApproved=true 로 바로 분석·발행한다."
  //   우회로가 없으면 어떻게 되는지는 실물이 보여준다 — 현행 발행 이력의 수동 웹 항목
  //   (IDSA 2026 AMR Guidance)이 초록 없는 합성 문서라 양성 증거 두 축을 못 채워
  //   `needsReview` 로 떨어졌다(2026-08-15 소급 판정). PeterJ 가 직접 넣은 것이
  //   자동 필터에 막히는 것은 ⑤-A 정면 위반이다.
  if (candidate?.manualApproved === true) {
    return {
      verdict: 'guideline',
      documentType: inferDocumentType(normalized(candidate?.title), publicationTypes(candidate)) ?? 'guideline',
      reasons: ['manual-approved'],
      evidence: { format: true, publisher: true, normative: true, official: true },
      signals: { manualApproved: true, officialDocument: true, approvedOrganization: true },
    };
  }
  const title = normalized(candidate?.title);
  const types = publicationTypes(candidate ?? {});
  const negative = NEGATIVE_PATTERNS.find(([, pattern]) => pattern.test(title));
  const editorialType = types.some((type) => /\b(?:editorial|comment|letter)\b/.test(type));
  const guidelineType = types.some((type) => /^(?:practice )?guideline$/.test(type));
  const documentType = inferDocumentType(title, types);
  const organization = orgs ? matchOrganization(candidate ?? {}, orgs) : null;
  const body = normalized([candidate?.abstract, candidate?.fullText, candidate?.content].filter(Boolean).join(' '));
  const normative = /\b(?:recommend(?:ation|ations|ed|s)?|should|class of recommendation|level of evidence|guidance)\b/.test(body);
  const discoveredBy = (candidate?.discoveredBy ?? []).map(normalized);
  const approvedOrgSource = discoveredBy.some((source) => source.startsWith('org '))
    || candidate?.signals?.approvedOrgPath === true
    || candidate?.signals?.approvedOrganizationSource === true;
  const pubmedOfficial = candidate?.signals?.pubmedOfficial === true
    || candidate?.signals?.officialDocument === true
    || (guidelineType && (candidate?.pmid || discoveredBy.some((source) => source.startsWith('pubmed'))));

  const evidence = {
    format: Boolean(documentType),
    publisher: Boolean(organization),
    normative,
    official: approvedOrgSource || pubmedOfficial,
  };
  const signals = {
    guidelinePublicationType: guidelineType,
    pubmedPt: guidelineType,
    expandedTitle: Boolean(documentType && !guidelineType),
    approvedOrganization: Boolean(organization),
    approvedOrgPath: approvedOrgSource,
    normativeContent: normative,
    explicitRecommendation: normative,
    officialDocument: evidence.official,
    organizationId: organization?.organizationId ?? null,
  };

  // ★ 해설·요약 부류는 **기각이 아니라 격리**다 (재생 실험 W3 실측, 2026-08-15).
  //   "Executive summary of the Brain Trauma Foundation Guidelines ... Second Edition" 이
  //   `summary of the` 에 걸려 기각됐는데, 지침의 **공식 요약본은 지침 그 자체의 일부**다.
  //   반대로 "지침을 요약한 저널 소개글" 은 지침이 아니다 — 제목만으로는 갈리지 않는다.
  //   설계 원칙(§6.5)이 바로 이 경우를 위한 것이다: 애매한 것은 점수로 눌러 언젠가
  //   발행시키지도, 버리지도 말고 `needsReview` 로 격리한다.
  //   확실한 부정(합의과정 연구·논평·이행 연구)은 그대로 기각한다.
  const digestFamily = negative?.[0] === 'guideline-commentary-or-digest';
  if (negative && digestFamily) {
    return { verdict: 'needsReview', documentType, reasons: [negative[0]], evidence, signals };
  }
  if (negative && !editorialType && !guidelineType) {
    return { verdict: 'rejected', documentType, reasons: [negative[0]], evidence, signals };
  }
  if (negative || editorialType) {
    return {
      verdict: 'needsReview', documentType,
      reasons: [negative?.[0], editorialType && 'conflicting-editorial-publication-type'].filter(Boolean),
      evidence, signals,
    };
  }

  const axes = Object.values(evidence).filter(Boolean).length;
  if (axes < 2) {
    return { verdict: 'needsReview', documentType, reasons: ['insufficient-positive-evidence'], evidence, signals };
  }
  return {
    verdict: 'guideline', documentType,
    reasons: Object.entries(evidence).filter(([, value]) => value).map(([key]) => `${key}-evidence`),
    evidence, signals,
  };
}
