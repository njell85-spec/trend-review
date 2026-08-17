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
  // ★ 순서가 판정을 가른다 — `find` 가 **첫 매치**를 돌려주고, 아래 HARD_REJECT 넷은
  //   PT 가 붙어 있어도 기각이지만 그 뒤 패턴들은 격리로 떨어진다.
  //   실측: "A comparative evaluation of large language models in aligning with ERS
  //   guidelines…" 가 `commentary-or-evaluation`(‘evaluation of’)에 먼저 걸려
  //   LLM 벤치마크인데 needsReview 로 샜다. 그래서 넷을 맨 앞에 둔다.
  // ═══ 아래 넷은 **관심주제 축을 켠 첫 실측(2026-08-17)에서 queued 로 올라온 것들**이다.
  //     주제축이 그물을 넓히자 "제목에 guideline 이 들어간 연구논문" 이 한꺼번에 들어왔다.
  //     전부 지침 본문이 아니므로 기각한다(§HARD_REJECT — PT 가 붙어 있어도 기각이다).

  // ① 정정문. priority 10~10.8 로 **상위권에 앉아 있었다** — 그대로 두면 발행된다.
  //    실측: "Correction to: 2026 Guideline for the Early Management of Patients With
  //    Acute Ischemic Stroke…", "Corrigendum to: 2025 ESC/EACTS Guidelines…"
  //    제목 맨 앞에만 건다 — 본문 중간의 'correction' 은 산-염기 교정 같은 임상 용어다.
  ['correction-or-erratum', /^(?:correction|corrigendum|erratum)\b/],

  // ② "Get With The Guidelines" 는 **AHA 의 레지스트리 이름**이다. 지침이 아니다.
  //    실측 3건이 전부 그 레지스트리 자료 분석 논문이었다.
  //    반드시 고유명사 구 전체로만 매칭한다 — 일반 'guidelines' 를 삼키면 진짜 지침이 죽는다.
  ['registry-named-guidelines', /\bget with the guidelines\b/],

  // ③ 지침 **준수도·이행·실사용** 연구. 지침을 소재로 삼은 관찰연구다.
  //    실측: "Adherence to strong recommendations of the German Polytrauma Guideline…",
  //    "…non-guideline-concordant… Findings from a French critical care cohort",
  //    "Real-world adoption of the 2023 ESC guidelines… Insights from the READAPT-2 survey",
  //    "Educational professional activities… data from the OpTIMa-HF Registry"
  //    ★ 근거출처 문구('findings from a' 등)로 잡는다 — 지침 제목은 자기 근거를 이렇게 안 쓴다.
  ['guideline-uptake-study', /\b(?:adherence to (?:\w+\s+){0,3}(?:recommendations?|guidelines?)|guideline concordan|real world adoption|findings from a|insights from the|data from the|an analysis (?:from|of) the|a retrospective cohort study|strength and quality of evidence)\b/],

  // ④ LLM 성능평가 논문. 실측 3건(ChatGPT 일치도·LLM 정렬 비교).
  ['llm-benchmark-study', /\b(?:chat ?gpts?|large language models?|llms?|gemini|copilot)\b/],


  ['consensus-process-study', /\b(?:consensus process|consensus methods|developing consensus|consensus exercise|delphi (?:study|survey|round)|agreement among|validation of consensus|adherence to recommendations)\b/],
  ['commentary-or-evaluation', /\b(?:commentary on|editorial|perspective|response to|letter|what is new in|implications of|appraisal of|evaluation of|comparison of guidelines|implementation of guidelines|barriers to guideline|guideline adherence)\b/],
  // ★ 지침 *해설·적용* 논문 — 현행 경로가 실제로 발행한 오탐에서 왔다.
  //   `output/selected_guidelines.json` 의 PMID 42373461
  //   "[The 2026 Surviving Sepsis Campaign guidelines: from evidence updates to practice implementation]."
  //   원 지침이 아니라 그 지침을 **해설하는** 논문인데, 위 두 패턴 어디에도 안 걸려
  //   `guideline` 으로 통과했다(2026-08-15 소급 판정으로 확인).
  //   형식은 "<지침 이름> : <그것을 어떻게 읽고 적용하나>" 다.

  ['guideline-commentary-or-digest', /\b(?:to practice implementation|practice implementation|interpretation of|interpreting the|key points of|highlights of|highlights and|overview of the|reading the|a summary of|summary of the|update on the|ten commandments|a guide for|pertinent points|pearls from|reflections on)\b/],
];

// ★ 이 코드들은 **PT 가 붙어 있어도 기각**한다.
//   아래 분기(`negative && !editorialType && !guidelineType`)는 PubMed 가 Guideline 으로
//   색인한 문서를 기각 대신 격리하는데(F3 이후 `guidelineType` 이 발견경로로도 켜진다),
//   정정문·레지스트리 분석·준수도 연구·LLM 벤치마크는 **색인이 무엇이든 지침이 아니다.**
//   격리해 두면 needsReview 에 쌓이기만 하고 아무도 안 본다.
const HARD_REJECT_CODES = new Set([
  'correction-or-erratum', 'registry-named-guidelines', 'guideline-uptake-study', 'llm-benchmark-study',
]);

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
  const discoveredByRaw = (candidate?.discoveredBy ?? []).map(normalized);
  // ★ PT 쿼리가 돌려준 것은 **PubMed 자신이 Guideline/Practice Guideline 으로 색인한 것**이다.
  //   `pubmed-pt` 쿼리 자체가 `("practice guideline"[Publication Type]) OR ("guideline"[Publication Type])`
  //   이므로, 거기서 나왔다는 사실은 publicationTypes 를 다시 읽는 것과 같은 증거다.
  //   종전에는 `publicationTypes` **하나만** 봤고, 그 배열이 esummary 필드명 오류로 통째로
  //   비어 있었다(F1). 그래서 **PT 로 찾아온 문서가 "PT 가 아님" 으로 판정되는** 자기모순이
  //   났다. F1 을 고쳐도 esummary 가 PT 를 늦게 다는 날은 같은 일이 재발하므로, 발견 경로
  //   자체를 두 번째 근거로 세워 둔다.
  const ptDiscovered = discoveredByRaw.includes('pubmed pt');
  const guidelineType = types.some((type) => /^(?:practice )?guideline$/.test(type)) || ptDiscovered;
  const documentType = inferDocumentType(title, types) ?? (ptDiscovered ? 'guideline' : null);
  const organization = orgs ? matchOrganization(candidate ?? {}, orgs) : null;
  const body = normalized([candidate?.abstract, candidate?.fullText, candidate?.content].filter(Boolean).join(' '));
  const normative = /\b(?:recommend(?:ation|ations|ed|s)?|should|class of recommendation|level of evidence|guidance)\b/.test(body);
  const discoveredBy = discoveredByRaw;
  const approvedOrgSource = discoveredBy.some((source) => source.startsWith('org '))
    || candidate?.signals?.approvedOrgPath === true
    || candidate?.signals?.approvedOrganizationSource === true;
  // ★ `Boolean(...)` 로 감싼다. 종전에는 `guidelineType && candidate.pmid` 가 **pmid 문자열**을
  //   그대로 돌려줘서 `evidence.official` 에 `'42522393'` 같은 값이 들어갔다. 축 개수를 세는
  //   데는 truthy 라 문제가 안 났지만, 이 evidence 객체는 **상태 파일에 그대로 직렬화**되므로
  //   나중에 `=== true` 로 읽는 코드가 조용히 어긋난다. 계약은 boolean 이다
  //   (`test/guidelineClassifier.test.mjs` 의 코퍼스 계약이 그렇게 못 박고 있다).
  const pubmedOfficial = candidate?.signals?.pubmedOfficial === true
    || candidate?.signals?.officialDocument === true
    || Boolean(guidelineType && (candidate?.pmid || discoveredBy.some((source) => source.startsWith('pubmed'))));

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
  if (negative && HARD_REJECT_CODES.has(negative[0])) {
    return { verdict: 'rejected', documentType, reasons: [negative[0]], evidence, signals };
  }
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
