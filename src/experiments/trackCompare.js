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

const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
export function parseYearMonth(s) {
  const parts = String(s ?? '').split(/[-/\s]+/).filter(Boolean);
  if (!parts.length) return null;
  const year = Number(parts[0]);
  if (!Number.isFinite(year) || year < 1900) return null;
  let month = 0;
  if (parts[1]) {
    const m = parts[1].toLowerCase();
    month = Number.isFinite(Number(parts[1])) ? Number(parts[1]) - 1 : (MONTHS[m.slice(0, 3)] ?? 0);
  }
  const dt = new Date(Date.UTC(year, month, 1));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Arm2가 반환한 pick(PMID)을 PubMed 재조회로 검증하고 6개월 창을 확인.
// fetchArticles는 주입(테스트 목 가능). 성공 시 canonical paper 객체 반환.
export async function verifyPick(pick, { fetchArticles, sinceDate }) {
  const pmid = String(pick?.pmid ?? '').trim();
  if (!/^\d+$/.test(pmid)) return { ok: false, paper: null, reason: `invalid pmid: "${pick?.pmid ?? ''}"` };

  let articles = [];
  try { articles = await fetchArticles([pmid]); } catch (err) { return { ok: false, paper: null, reason: `fetch error: ${err.message}` }; }
  const paper = Array.isArray(articles) ? articles.find((a) => String(a.pmid) === pmid) : null;
  if (!paper) return { ok: false, paper: null, reason: `PMID ${pmid} not found on PubMed` };

  const pub = parseYearMonth(paper.pubDate);
  const since = new Date(`${sinceDate}T00:00:00Z`);
  if (!pub) return { ok: false, paper: null, reason: `unparseable pubDate "${paper.pubDate}"` };
  if (pub < since) return { ok: false, paper: null, reason: `outside 6-month window (pubDate ${paper.pubDate} < ${sinceDate})` };

  return { ok: true, paper, reason: 'ok' };
}

export function assembleRecord({ date, arm1, arm2 }) {
  const converged = Boolean(arm1?.pmid && arm2?.pmid && String(arm1.pmid) === String(arm2.pmid));
  return { date, arm1: arm1 ?? null, arm2: arm2 ?? null, arm3: null, converged };
}

export function upsertRecord(comparison, record) {
  const c = comparison ?? { records: [] };
  c.records = Array.isArray(c.records) ? c.records : [];
  const i = c.records.findIndex((r) => r.date === record.date);
  if (i >= 0) c.records[i] = record; else c.records.push(record);
  return c;
}

export function isPastEndDate(today, endDate) {
  if (!endDate) return false;
  return String(today) > String(endDate);
}
