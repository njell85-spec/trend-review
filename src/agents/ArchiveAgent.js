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

// 상태 파일 지속: 로컬에 쓰면 워크플로우의 "Commit daily state" 스텝이 git으로 커밋한다.
// (contents API 커밋은 그 스텝의 push와 non-fast-forward 충돌을 일으키므로 쓰지 않는다)
const ARCHIVE_PATH = path.join(process.cwd(), 'output', 'analysis_archive.json');
const UNPAYWALL = 'https://api.unpaywall.org/v2';
const EPMC_PDF = (pmcid) => `https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC${pmcid}&blobtype=pdf`;
const WEB_PREFIX = '웹 — '; // FilterAnalyzerAgent._provenance()의 웹보강 라벨 접두

export const monthOf = (d) => d.slice(0, 7);
export const pdfFileName = ({ date, pmid, title }) =>
  `${date}_${pmid}_${String(title).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)}.pdf`;

export function toArchiveEntry(a, { pdfLink, todayKST }) {
  const p = a.paper ?? {};
  return {
    date: todayKST,
    pmid: a.pmid ?? p.pmid,
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
    const entryPmid = analysis.pmid ?? analysis.paper?.pmid;
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
    return { ok: true, pdf: Boolean(pdfLink), docUpdated };
  }

  async _loadArchive() {
    try {
      const j = JSON.parse(await readFile(ARCHIVE_PATH, 'utf8'));
      return {
        entries: j.entries ?? [],
        driveState: { docIds: {}, folderIds: {}, pdfFiles: {}, ...(j.driveState ?? {}) },
      };
    } catch {
      return { entries: [], driveState: { docIds: {}, folderIds: {}, pdfFiles: {} } };
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
    const pmid = analysis.pmid ?? p.pmid;
    if (state.driveState.pdfFiles[pmid]) {
      return `https://drive.google.com/file/d/${state.driveState.pdfFiles[pmid]}/view`;
    }
    // 상태 유실(커밋 실패) 대비: Drive에서 같은 파일명을 먼저 찾는다 (find-or-create)
    const fileName = pdfFileName({ date: todayKST, pmid, title: p.title });
    const existing = await drive.files.list({
      q: `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id)',
    });
    if (existing.data.files?.length) {
      state.driveState.pdfFiles[pmid] = existing.data.files[0].id;
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
    state.driveState.pdfFiles[pmid] = file.data.id;
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
