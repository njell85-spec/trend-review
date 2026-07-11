import { readFileSync } from 'fs';
import { fileURLToPath, URL } from 'url';

function _defaultProfile() {
  try {
    const url = new URL('../../config/interests.json', import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8'));
  } catch { return { topicGroups: {} }; }
}

// interests.json → Arm2 프롬프트용 한 줄 관심 힌트.
// 그룹별로 "라벨: term1, term2, term3(대표 3개)" 를 '; '로 잇는다.
export function extractInterestKeywords(profile = _defaultProfile()) {
  const groups = Object.values(profile.topicGroups ?? {});
  const parts = groups.map((g) => {
    const terms = (g.terms ?? []).slice(0, 3).join(', ');
    return `${g.label ?? ''}: ${terms}`.trim();
  }).filter((s) => s.length > 1);
  return parts.join('; ');
}

export const ARM2_PICK_TOOL = {
  name: 'submit_track_pick',
  description: 'Submit the single chosen EM/CCM paper for today.',
  input_schema: {
    type: 'object',
    properties: {
      pmid: { type: 'string', description: 'Real PubMed ID (digits only) that you verified exists via web search. Never invent it.' },
      doi: { type: 'string', description: 'DOI if known, else empty string.' },
      title: { type: 'string' },
      journal: { type: 'string' },
      pubDate: { type: 'string', description: 'Publication year-month, e.g. "2026-05".' },
      whyChosen: { type: 'string', description: 'One or two sentences on why this has the highest clinical bedside utility.' },
    },
    required: ['pmid', 'title', 'journal', 'whyChosen'],
  },
};

// Arm2 유저 프롬프트. 시스템(의료 리뷰 컨텍스트)은 LLMClient 내부 적용.
export function buildArm2SelectPrompt({ sinceDate, keywords, excludePmids = [] }) {
  const exclude = excludePmids.length ? excludePmids.join(', ') : 'None';
  return `You are an expert emergency medicine and critical care (EM/CCM) physician.
Using web search, find exactly ONE peer-reviewed primary research paper published on or after ${sinceDate} (last 6 months) in a NOTABLE EM/CCM journal, with the HIGHEST clinical bedside utility for an acute/critical-care physician.

Interest areas to weigh (hints, not hard filters): ${keywords}.

Prefer studies that directly change acute bedside management (diagnosis, drug, procedure, resuscitation target). Avoid pure epidemiology, health-services, interhospital-transfer, remote-monitoring, quality-improvement, narrative reviews, case reports, and protocols unless clearly practice-changing.

Do NOT choose any of these already-selected PMIDs: ${exclude}.

Return your single choice via the submit_track_pick tool. The PMID MUST be a real PubMed identifier you verified via search — do not invent it. Prefer including the DOI and the publication year-month.`;
}
