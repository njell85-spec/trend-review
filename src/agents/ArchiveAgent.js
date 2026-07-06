/**
 * ArchiveAgent — Phase 2: 논문 PDF Drive 적재 + 월별 리빙 Doc 갱신 + 아카이브 JSON 로컬 기록.
 *
 * 전 과정 소프트 실패(호출측 try/catch) · 재실행 안전(driveState·upsert + Drive측 find 폴백) ·
 * 토큰 로그 금지.
 * 상태 파일: output/analysis_archive.json
 *   { entries: [...], driveState: { rootFolderId, docIds: {"YYYY-MM": id}, folderIds: {...}, pdfFiles: {pmid: fileId} } }
 * 러너가 휘발이므로 상태 파일은 워크플로우 "Commit daily state" 스텝이 git으로 커밋해 지속한다.
 */
import { google } from 'googleapis';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { Readable } from 'stream';
import path from 'path';
import { Logger } from '../utils/Logger.js';
import { getGoogleAuth } from '../utils/googleAuth.js';
import { buildMonthDocHtml } from '../utils/docBuilder.js';
import { fulltextDocName, fulltextSectionText } from '../utils/fulltextDoc.js';
import { fetchRefTexts } from '../utils/webRefText.js';

// 상태 파일 지속: 로컬에 쓰면 워크플로우의 "Commit daily state" 스텝이 git으로 커밋한다.
// (contents API 커밋은 그 스텝의 push와 non-fast-forward 충돌을 일으키므로 쓰지 않는다)
const ARCHIVE_PATH = path.join(process.cwd(), 'output', 'analysis_archive.json');
const UNPAYWALL = 'https://api.unpaywall.org/v2';
const EPMC_PDF = (pmcid) => `https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC${pmcid}&blobtype=pdf`;
const WEB_PREFIX = '웹 — '; // FilterAnalyzerAgent._provenance()의 웹보강 라벨 접두

export const monthOf = (d) => d.slice(0, 7);
export const pdfFileName = ({ date, pmid, title }) =>
  `${date}_${pmid}_${String(title).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)}.pdf`;

// dedup(upsertEntry)·PDF 키(pdfFiles)·파일명에 쓰는 PMID. 수집기가 채운 paper.pmid가
// 권위값이며, LLM이 되돌려준 최상위 analysis.pmid는 빈 문자열('')일 수 있어 뒤에 둔다
// (?? 는 빈 문자열을 통과시켜 폴백을 막으므로 || 사용 — 빈 pmid는 같은 날 여러 항목의
// dedup 키를 ''로 충돌시켜 아카이브 유실·OA PDF 오탐 스킵을 유발한다).
export const entryPmidOf = (a) => String(a?.paper?.pmid || a?.pmid || '');

export function toArchiveEntry(a, { pdfLink, todayKST }) {
  const p = a.paper ?? {};
  return {
    date: todayKST,
    pmid: entryPmidOf(a),
    title: p.title,
    title_ko: a.title_ko,
    journal: p.journal,
    doi: p.doi ?? null,
    badge: a.evidenceSource ?? p.fullTextSource ?? '초록만',
    clinicalQuestion_ko: a.clinicalQuestion_ko,
    pico: a.pico ?? {}, // 영어 PICO — 영상 대본(EN) 생성 입력이 프로덕션과 동일하도록 보존
    pico_ko: a.pico_ko ?? {},
    keyFindings: a.keyFindings ?? [],
    keyFindings_ko: a.keyFindings_ko ?? [],
    evidenceLevel: a.evidenceLevel ?? null,
    references: a.sources ?? [],
    fullText: p.fullText ?? null,
    fullTextSource: p.fullTextSource ?? 'abstract-only',
    dossier: buildDossier(a),
    pdfLink: pdfLink ?? null,
  };
}

/** 페이월(본문 없음) + 웹보강 출처가 있으면 도시에 항목으로 구조화 (자체 문서 — 타인 파일 수집 금지) */
function buildDossier(a) {
  if (a.paper?.fullText) return null;
  const web = (a.sources ?? []).filter((s) => String(s.label ?? '').startsWith(WEB_PREFIX));
  if (!web.length) return null;
  return web.map((s) => ({
    source: String(s.label).slice(WEB_PREFIX.length),
    url: s.url,
    note: '웹보강 근거 (권위 소스)',
  }));
}

export function upsertEntry(entries, entry) {
  const rest = entries.filter((e) => !(e.date === entry.date && e.pmid === entry.pmid));
  return [...rest, entry];
}

export class ArchiveAgent {
  constructor() {
    this.logger = new Logger('ArchiveAgent', { logFile: 'archive_agent.jsonl' });
  }

  async run({ analysis, todayKST }) {
    const auth = await getGoogleAuth({ logger: this.logger });
    if (!auth) return { ok: false, reason: 'google-auth-unset' };
    const drive = google.drive({ version: 'v3', auth });
    const state = await this._loadArchive();
    const month = monthOf(todayKST);

    // 항목을 Drive 작업보다 먼저 확정 저장 — 폴더 확보·업로드가 실패해도 그날 데이터는
    // 남아 다음 실행의 Doc 재생성에 포함된다. Doc은 매일 전체 재생성이지만 entries 는
    // 당일 실행에서만 추가되므로, 여기서 유실되면 그 날짜는 영구 결번이 된다.
    // 재실행 시 이전 실행이 확보한 pdfLink는 보존한다(덮어쓰기로 링크 유실 방지).
    // (부분 실패가 데이터를 망치지 않도록: 전역 체크리스트 ④)
    const entryPmid = entryPmidOf(analysis);
    const prevLink = state.entries.find((e) => e.date === todayKST && e.pmid === entryPmid)?.pdfLink ?? null;
    state.entries = upsertEntry(state.entries, toArchiveEntry(analysis, { pdfLink: prevLink, todayKST }));
    await this._saveArchive(state);

    const folderId = await this._ensureMonthFolder(drive, state, month);

    // PDF는 실패해도 계속 (OA가 아닌 날이 정상 경로)
    let pdfLink = null;
    try {
      pdfLink = await this._uploadPdf(drive, state, analysis, todayKST, folderId);
    } catch (e) {
      this.logger.warn(`PDF 단계 실패(계속): ${e.message}`);
    }

    if (pdfLink) {
      state.entries = upsertEntry(state.entries, toArchiveEntry(analysis, { pdfLink, todayKST }));
    }
    await this._saveArchive(state); // folderId·pdfFileId 반영

    let docUpdated = true;
    try {
      const monthEntries = state.entries.filter((e) => monthOf(e.date) === month);
      await this._upsertMonthDoc(drive, state, month, folderId, buildMonthDocHtml(month, monthEntries));
      await this._saveArchive(state); // docId 반영
    } catch (e) {
      docUpdated = false;
      this.logger.warn(`리빙 Doc 갱신 실패(항목은 저장됨 — 다음 실행에서 재생성): ${e.message}`);
    }

    // 전문 Doc(§4-E b′·c) — append-only, 소프트 실패 (실패해도 fulltextDone 미기록이라 재시도됨)
    let fulltextUpdated = false;
    try {
      fulltextUpdated = await this._appendFulltextDoc(drive, state, month, folderId);
      await this._saveArchive(state); // fulltextDocId·fulltextDone 반영
    } catch (e) {
      this.logger.warn(`전문 Doc 갱신 실패(다음 실행에서 재시도): ${e.message}`);
    }
    return { ok: true, pdf: Boolean(pdfLink), docUpdated, fulltextUpdated };
  }

  /**
   * 월별 전문 Doc(plain text) append — pmid당 1회(fulltextDone). OA는 entry.fullText,
   * 페이월은 dossier 웹 레퍼런스 본문 수집(fetchRefTexts). 본문은 Drive Doc으로만
   * 보낸다(공개 repo 커밋 금지 — HANDOFF §3 비공개층 한정 수집). drive.file 스코프로
   * 충분: 앱 생성 Doc의 files.export(text/plain) → 덧붙임 → files.update(text/plain).
   */
  async _appendFulltextDoc(drive, state, month, folderId) {
    const done = new Set(state.driveState.fulltextDone[month] ?? []);
    const targets = state.entries.filter(
      (e) => monthOf(e.date) === month && e.pmid && !done.has(e.pmid));
    if (!targets.length) return false;

    let docId = state.driveState.fulltextDocIds[month] ?? null;
    if (!docId) {
      // 상태 유실(커밋 실패) 대비: 같은 이름 Doc 재사용 (중복 생성 방지)
      const name = fulltextDocName(month);
      const found = await drive.files.list({
        q: `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.document' and '${folderId}' in parents and trashed=false`,
        fields: 'files(id)',
      });
      docId = found.data.files?.[0]?.id ?? null;
    }

    let body = '';
    if (docId) {
      const cur = await drive.files.export(
        { fileId: docId, mimeType: 'text/plain' }, { responseType: 'text' });
      body = String(cur.data ?? '');
      // 데이터 보호 가드: export가 기록 길이보다 크게 짧으면(빈/절단 응답) 이번 실행을
      // 중단한다 — 그대로 update하면 Doc이 유일 저장소인 수집 본문이 통째로 유실된다
      // (전역 체크리스트 ④). 다음 실행에서 재시도.
      const prevLen = state.driveState.fulltextLen[month] ?? 0;
      if (body.length < prevLen * 0.8) {
        throw new Error(`전문 Doc export 길이 이상(${body.length} < 기록 ${prevLen}의 80%) — append 중단`);
      }
    } else {
      body = `${fulltextDocName(month)}\n개인 연구용 비공개 아카이브 — 본문·권위 레퍼런스 수집(사적 이용 복제).`;
    }

    let appended = 0;
    for (const e of targets) {
      const webTexts = e.fullText ? [] : await fetchRefTexts(e.dossier, {});
      const section = fulltextSectionText(e, webTexts);
      // 레퍼런스가 있었는데 전부 실패(일시 오류 가능)면 done 유보 — 다음 실행에서 재시도.
      // 본문·레퍼런스 자체가 없는 항목(초록만)은 '처리됨'으로 마킹해 매일 재fetch 방지.
      const refsAllFailed = !e.fullText && (e.dossier?.length ?? 0) > 0 && !webTexts.length;
      if (!refsAllFailed) done.add(e.pmid);
      if (!section) continue;
      body += section;
      appended += 1;
    }
    state.driveState.fulltextDone[month] = [...done];
    if (!appended && docId) return false; // 새로 넣을 게 없으면 업로드 생략

    const media = { mimeType: 'text/plain', body: Readable.from(Buffer.from(body, 'utf8')) };
    if (docId) {
      await drive.files.update({ fileId: docId, media });
    } else {
      const created = await drive.files.create({
        requestBody: {
          name: fulltextDocName(month),
          mimeType: 'application/vnd.google-apps.document',
          parents: [folderId],
        },
        media,
        fields: 'id',
      });
      docId = created.data.id;
    }
    state.driveState.fulltextDocIds[month] = docId;
    state.driveState.fulltextLen[month] = body.length; // 다음 실행의 export 이상 감지 기준
    this.logger.info(`전문 Doc 갱신: ${month} (+${appended}편, 총 ${(body.length / 1024).toFixed(0)}KB)`);
    return true;
  }

  async _loadArchive() {
    try {
      const j = JSON.parse(await readFile(ARCHIVE_PATH, 'utf8'));
      return {
        entries: j.entries ?? [],
        driveState: {
          docIds: {}, folderIds: {}, pdfFiles: {}, fulltextDocIds: {}, fulltextDone: {}, fulltextLen: {},
          ...(j.driveState ?? {}),
        },
      };
    } catch {
      return {
        entries: [],
        driveState: {
          docIds: {}, folderIds: {}, pdfFiles: {}, fulltextDocIds: {}, fulltextDone: {}, fulltextLen: {},
        },
      };
    }
  }

  async _saveArchive(state) {
    await mkdir(path.dirname(ARCHIVE_PATH), { recursive: true });
    await writeFile(ARCHIVE_PATH, JSON.stringify(state, null, 2), 'utf8');
  }

  /**
   * 적재 루트 폴더 확보. drive.file 스코프는 **이 앱이 만들었거나 사용자가 피커로 연
   * 파일만** 접근 가능 — Drive UI에서 수동 생성한 폴더 ID를 GOOGLE_DRIVE_FOLDER_ID로
   * 넣으면 files.get/create가 404를 던진다. 그래서 접근을 먼저 검증하고, 불가하면
   * 앱이 직접 만든 `trend-review` 폴더(내 드라이브 루트)로 폴백한다(find-or-create).
   */
  async _ensureRootFolder(drive, state) {
    if (state.driveState.rootFolderId) return state.driveState.rootFolderId;
    const configured = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (configured) {
      try {
        await drive.files.get({ fileId: configured, fields: 'id' });
        state.driveState.rootFolderId = configured;
        return configured;
      } catch (e) {
        this.logger.warn(
          `GOOGLE_DRIVE_FOLDER_ID 접근 불가(HTTP ${e.code ?? '?'}) — drive.file 스코프는 앱이 만든 폴더만 접근 가능. 앱 관리 폴더 'trend-review'로 폴백`,
        );
      }
    }
    const q = "name='trend-review' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false";
    const found = await drive.files.list({ q, fields: 'files(id)' });
    const id =
      found.data.files?.[0]?.id ??
      (
        await drive.files.create({
          requestBody: { name: 'trend-review', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] },
          fields: 'id',
        })
      ).data.id;
    state.driveState.rootFolderId = id;
    return id;
  }

  async _ensureMonthFolder(drive, state, month) {
    if (state.driveState.folderIds[month]) return state.driveState.folderIds[month];
    const parent = await this._ensureRootFolder(drive, state);
    const q = `name='${month}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
    const found = await drive.files.list({ q, fields: 'files(id)' });
    const id =
      found.data.files?.[0]?.id ??
      (
        await drive.files.create({
          requestBody: { name: month, mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
          fields: 'id',
        })
      ).data.id;
    state.driveState.folderIds[month] = id;
    return id;
  }

  /** Unpaywall url_for_pdf → EuropePMC 렌더 순서로 OA PDF 시도. 이미 올린 pmid는 스킵(재실행 안전). */
  async _uploadPdf(drive, state, analysis, todayKST, folderId) {
    const p = analysis.paper ?? {};
    const pmid = entryPmidOf(analysis);
    // 빈 pmid는 캐시 키로 쓰지 않는다 — pdfFiles['']가 서로 다른 논문 간에 공유되면
    // 다른 논문의 PDF 링크가 오탐 반환된다 (레거시 빈 pmid 항목 방어)
    if (pmid && state.driveState.pdfFiles[pmid]) {
      return `https://drive.google.com/file/d/${state.driveState.pdfFiles[pmid]}/view`;
    }
    // 상태 유실(커밋 실패) 대비: Drive에서 같은 파일명을 먼저 찾는다 (find-or-create)
    const fileName = pdfFileName({ date: todayKST, pmid, title: p.title });
    const existing = await drive.files.list({
      q: `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id)',
    });
    if (existing.data.files?.length) {
      if (pmid) state.driveState.pdfFiles[pmid] = existing.data.files[0].id;
      return `https://drive.google.com/file/d/${existing.data.files[0].id}/view`;
    }
    const url = await this._resolvePdfUrl(p);
    if (!url) {
      this.logger.info(`OA PDF 없음 (PMID ${pmid}) — 스킵`);
      return null;
    }
    const res = await fetch(url, { redirect: 'follow' });
    const ctype = res.headers.get('content-type') ?? '';
    if (!res.ok || !ctype.includes('pdf')) {
      this.logger.info(`PDF 응답 아님 (HTTP ${res.status}, ${ctype.slice(0, 40)}) — 스킵`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10_000) return null; // 오류 페이지 방어
    if (buf.length > 30_000_000) {
      this.logger.info(`PDF ${(buf.length / 1e6).toFixed(0)}MB > 30MB 상한 — 스킵 (러너 메모리 보호)`);
      return null;
    }
    const file = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: 'application/pdf', body: Readable.from(buf) },
      fields: 'id',
    });
    if (pmid) state.driveState.pdfFiles[pmid] = file.data.id;
    this.logger.info(`PDF 적재 완료 (PMID ${pmid}, ${(buf.length / 1024).toFixed(0)}KB)`);
    return `https://drive.google.com/file/d/${file.data.id}/view`;
  }

  async _resolvePdfUrl(p) {
    if (p.doi) {
      try {
        const email = process.env.PUBMED_EMAIL ?? process.env.UNPAYWALL_EMAIL ?? 'research@example.com';
        const r = await fetch(`${UNPAYWALL}/${encodeURIComponent(p.doi)}?email=${encodeURIComponent(email)}`);
        if (r.ok) {
          const j = await r.json();
          const pdf =
            j.best_oa_location?.url_for_pdf ??
            (j.oa_locations ?? []).map((l) => l.url_for_pdf).find(Boolean);
          if (pdf) return pdf;
        }
      } catch (e) {
        this.logger.warn(`Unpaywall PDF 조회 실패: ${e.message}`);
      }
    }
    if (p.pmcid) return EPMC_PDF(String(p.pmcid).replace(/^PMC/i, ''));
    return null;
  }

  /** 월 Doc find-or-create 후 HTML→Google Doc 변환 업데이트 (drive.file 스코프로 충분) */
  async _upsertMonthDoc(drive, state, month, folderId, html) {
    const media = { mimeType: 'text/html', body: Readable.from(Buffer.from(html, 'utf8')) };
    let docId = state.driveState.docIds[month];
    if (!docId) {
      // 상태 유실 대비: 같은 이름의 Doc이 이미 있으면 재사용 (중복 Doc 생성 방지)
      const found = await drive.files.list({
        q: `name='Trend Review — ${month}' and mimeType='application/vnd.google-apps.document' and '${folderId}' in parents and trashed=false`,
        fields: 'files(id)',
      });
      docId = found.data.files?.[0]?.id ?? null;
      if (docId) state.driveState.docIds[month] = docId;
    }
    if (docId) {
      await drive.files.update({ fileId: docId, media });
    } else {
      const created = await drive.files.create({
        requestBody: {
          name: `Trend Review — ${month}`,
          mimeType: 'application/vnd.google-apps.document',
          parents: [folderId],
        },
        media,
        fields: 'id',
      });
      docId = created.data.id;
      state.driveState.docIds[month] = docId;
    }
    this.logger.info(`리빙 Doc 갱신 완료: ${month} (${Math.round(html.length / 1024)}KB HTML)`);
  }
}
