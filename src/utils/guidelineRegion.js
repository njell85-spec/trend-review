// 지침의 **발표 기관** 기준 지역 판정.
//
// 저자 소속국·저널 발행국은 "누가 썼나"·"어디서 찍었나" 이지 "누가 낸 지침이냐" 가 아니다.
// 저널 발행국은 특히 나쁘다 — Elsevier=네덜란드, BMJ=영국이라 **출판사 주소**가 잡힌다.
// 지침은 거의 언제나 **제목에 발표 기관을 적는다**:
//   "2025 American Heart Association Guidelines for CPR…"
//   "2024 ESC Guidelines for the management of…"
//   "대한중환자의학회 …" / "Korean Society of … guidelines"
// 그래서 제목의 기관 표기를 1순위로 본다.
//
// 판정 순서: ① 제목의 기관명·약어 → ② 제목의 국적 형용사 → ③ 저자 소속국 → ④ 저널 발행국
// 앞쪽일수록 "발표 기관" 에 가깝다. 어느 단계에서 잡혔는지를 함께 돌려주므로
// 뒤쪽 근거로 잡힌 건은 따로 걸러 볼 수 있다.

// ── ① 기관 약어·정식명 ──────────────────────────────────────────────────────
// 약어는 대문자 단어 경계로만 잡는다("ACS" 가 acute coronary syndrome 과 겹치므로
// 약어 매칭은 대소문자를 구분한다).
export const ORGS = {
  us: {
    acronyms: ['AHA', 'ACC', 'ACEP', 'SCCM', 'IDSA', 'ATS', 'ACCP', 'NCS', 'AAN', 'ASA', 'SAEM',
      'EAST', 'ACG', 'AGA', 'AASLD', 'ASGE', 'AABB', 'ACR', 'AUA', 'ASH', 'ADA', 'AAP', 'ACOG',
      'AAFP', 'USPSTF', 'CDC', 'NIH', 'ASE', 'HRS', 'SVS', 'STS', 'SIR', 'NCCN', 'ASCO', 'AAAAI'],
    names: ['american heart association', 'american college of cardiology', 'american stroke association',
      'american college of emergency physicians', 'society of critical care medicine',
      'infectious diseases society of america', 'american thoracic society',
      'american college of chest physicians', 'neurocritical care society',
      'american academy of neurology', 'american society of anesthesiologists',
      'society for academic emergency medicine', 'eastern association for the surgery of trauma',
      'american college of surgeons', 'american college of gastroenterology',
      'american gastroenterological association', 'american diabetes association',
      'american academy of pediatrics', 'american college of obstetricians',
      'american urological association', 'american society of hematology',
      'centers for disease control', 'national institutes of health',
      'us preventive services task force', 'national comprehensive cancer network',
      'american college of radiology', 'heart rhythm society', 'society of thoracic surgeons',
      'society for vascular surgery', 'american society of echocardiography'],
    adjectives: ['american', 'united states', 'u.s. national'],
  },
  eu: {
    acronyms: ['ESC', 'ERC', 'ESICM', 'ESAIC', 'EUSEM', 'ERS', 'ESCMID', 'ESO', 'EAN', 'EASL',
      'ESGE', 'UEG', 'EHA', 'ESMO', 'EAU', 'ESPEN', 'NICE', 'SIGN', 'ESH', 'EACTS', 'ESTES',
      'DGAI', 'DGK', 'DGNI', 'SFAR', 'SIAARTI', 'SEMICYUC', 'NVIC', 'BTS', 'ESR', 'EFIC', 'ESVS'],
    names: ['european society of cardiology', 'european resuscitation council',
      'european society of intensive care medicine', 'european society of anaesthesiology',
      'european society for emergency medicine', 'european respiratory society',
      'european society of clinical microbiology', 'european stroke organisation',
      'european stroke organization', 'european academy of neurology',
      'european association for the study of the liver', 'european society of gastrointestinal endoscopy',
      'united european gastroenterology', 'european hematology association',
      'european society for medical oncology', 'european association of urology',
      'european society for clinical nutrition', 'european society of hypertension',
      'european association for cardio-thoracic surgery', 'european society for trauma',
      'national institute for health and care excellence',
      'scottish intercollegiate guidelines network', 'british thoracic society',
      'intensive care society', 'faculty of intensive care medicine',
      'deutsche gesellschaft', 'société française', 'societa italiana', 'sociedad española'],
    adjectives: ['european', 'british', 'german', 'deutsche', 'french', 'française', 'francaise',
      'italian', 'italiana', 'spanish', 'española', 'espanola', 'dutch', 'nederlandse', 'netherlands',
      'swedish', 'danish', 'norwegian', 'finnish', 'swiss', 'austrian', 'belgian', 'polish',
      'portuguese', 'greek', 'irish', 'scottish', 'nordic', 'scandinavian', 'uk national'],
  },
  kr: {
    acronyms: ['KSCCM', 'KSEM', 'KACPR', 'KSC', 'KSN', 'KDA', 'KSID'],
    names: ['korean society', 'korean association', 'korean academy', 'korean college',
      'korea disease control', 'korean stroke society', 'korean neurocritical care'],
    adjectives: ['korean', 'korea'],
  },
};

const ACRONYM_RE = Object.fromEntries(Object.entries(ORGS).map(([region, o]) => [
  region, new RegExp(`(?:^|[^A-Za-z])(?:${o.acronyms.join('|')})(?:[^A-Za-z]|$)`),
]));

const lower = (v) => String(v ?? '').toLowerCase();

const ADJ_OF = Object.entries(ORGS).flatMap(([region, o]) => o.adjectives.map((a) => [a, region]));

/**
 * ★ 기관명은 서로 부분문자열이다. "Korean Society of Critical Care Medicine" 안에는
 *   미국 SCCM 의 정식명 "society of critical care medicine" 이 통째로 들어 있어서,
 *   단순 `includes` 는 **한국 지침을 미국으로 잡는다**(실측으로 걸렸다).
 *   그래서 매칭된 기관명 **바로 앞 한 단어**가 다른 지역의 국적 형용사면 그쪽이 이긴다.
 */
function nationalityBefore(text, index) {
  const before = text.slice(Math.max(0, index - 24), index).trimEnd();
  const prev = before.split(/[\s(]+/).pop() ?? '';
  const hit = ADJ_OF.find(([adj]) => adj === prev);
  return hit ? hit[1] : null;
}

/** 제목에서 발표 기관을 찾는다. 가장 신뢰도 높은 근거다. */
export function regionFromTitle(title) {
  const raw = String(title ?? '');
  const t = lower(raw);
  // 정식 기관명이 약어보다 확실하다 — 먼저 본다.
  // 여러 개가 걸리면 **가장 긴 것**을 쓴다(짧은 이름이 긴 이름의 조각인 경우가 많다).
  const nameHits = [];
  for (const [region, o] of Object.entries(ORGS)) {
    for (const n of o.names) {
      const i = t.indexOf(n);
      if (i >= 0) nameHits.push({ region, name: n, index: i });
    }
  }
  if (nameHits.length) {
    nameHits.sort((a, b) => b.name.length - a.name.length);
    const best = nameHits[0];
    const owner = nationalityBefore(t, best.index);
    return { region: owner && owner !== best.region ? owner : best.region, by: 'org-name' };
  }
  for (const [region, re] of Object.entries(ACRONYM_RE)) {
    if (re.test(raw)) return { region, by: 'org-acronym' };
  }
  for (const [region, o] of Object.entries(ORGS)) {
    if (o.adjectives.some((a) => t.includes(a))) return { region, by: 'nationality' };
  }
  return null;
}

/**
 * 최종 판정. `fallbacks` 로 소속국·저널국 판정을 주입받는다(이 모듈은 국가 파싱을 하지 않는다).
 * 반환 `by` 가 뒤쪽 단계일수록 "발표 기관" 에서 멀다.
 */
export function resolveRegion({ title, affiliationRegion = null, journalRegion = null } = {}) {
  const fromTitle = regionFromTitle(title);
  if (fromTitle) return fromTitle;
  if (affiliationRegion && affiliationRegion !== 'other') return { region: affiliationRegion, by: 'affiliation' };
  if (journalRegion && journalRegion !== 'other') return { region: journalRegion, by: 'journal' };
  if (affiliationRegion) return { region: 'other', by: 'affiliation' };
  if (journalRegion) return { region: 'other', by: 'journal' };
  return { region: null, by: null };
}
