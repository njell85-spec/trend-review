#!/usr/bin/env python3
"""NotebookLM 소스 자동 등록 (notebooklm-py, 비공식 — HANDOFF §3 PeterJ 리스크 수용).

이번 달 분석 Doc + 전문 Doc을 노트북(NOTEBOOKLM_NOTEBOOK_ID)에 Drive URL 소스로 등록.
실패 시 exit 1 → notebooklm-sync.yml이 카톡 리마인더 폴백을 실행한다(소프트 실패).
인증 상태는 NOTEBOOKLM_AUTH_STATE secret을 러너 임시 파일로 복원해 사용
(경로는 NOTEBOOKLM_STORAGE 환경변수 — 워크플로우가 기록).

※ 비공식 라이브러리라 인터페이스 변동 가능 — 첫 실전 전 workflow_dispatch로 검증 필요
  (PeterJ 셋업 절차: HANDOFF §10 R3 참고).
"""
import asyncio
import json
import os
import sys
import time


def _diagnose_state(path: str) -> None:
    """인증 상태 파일의 안전한 메타데이터만 출력 — 실패 원인 구분용(값은 노출 금지).

    쿠키가 시간상 만료됐으면 '상태가 낡음(재발급 필요)', 만료 안 됐는데도
    from_storage가 거부당하면 'Google이 러너(데이터센터 IP)를 의심해 세션 무효화'로
    갈린다. 다음 실패 로그에서 이 둘을 바로 구분하려는 진단.
    """
    try:
        with open(path, encoding="utf-8") as fp:
            st = json.load(fp)
    except Exception as e:  # noqa: BLE001
        print(f"[진단] 인증 상태 파싱 실패 — 시크릿 손상 가능: {e}")
        return
    cookies = st.get("cookies", [])
    now = time.time()
    exps = [c["expires"] for c in cookies if isinstance(c.get("expires"), (int, float)) and c["expires"] > 0]
    expired = sum(1 for e in exps if e < now)
    google = sum(1 for c in cookies if "google" in str(c.get("domain", "")).lower())
    soonest = min(exps) if exps else None
    print(f"[진단] 쿠키 {len(cookies)}개(구글 {google}) · 만료됨 {expired}개 · "
          f"가장 이른 만료 {time.strftime('%Y-%m-%d', time.gmtime(soonest)) if soonest else 'n/a'} · "
          f"origins {len(st.get('origins', []))}개")
    if expired:
        print("[진단] → 만료된 쿠키 존재: 상태가 낡음. 데스크탑에서 재발급 후 즉시 재시도 권장.")
    else:
        print("[진단] → 시간상 유효: 그래도 거부되면 Google의 러너 IP 의심(자동화 근본 한계).")


async def main() -> None:
    from notebooklm import NotebookLMClient  # pip install notebooklm-py

    nb_id = os.environ["NOTEBOOKLM_NOTEBOOK_ID"]
    month = os.environ["TARGET_MONTH"]
    with open("output/analysis_archive.json", encoding="utf-8") as fp:
        ds = json.load(fp).get("driveState", {})
    doc_ids = [ds.get("docIds", {}).get(month), ds.get("fulltextDocIds", {}).get(month)]
    urls = [f"https://docs.google.com/document/d/{i}/edit" for i in doc_ids if i]
    if len(urls) < 2:
        # 분석·전문 Doc 둘 다 있어야 성공. 부족하면 exit 1 → 카톡 리마인더 폴백.
        # 여기서 조용히 성공하면(그달 데일리 미실행·상태 커밋 지연·전문 Doc 미생성)
        # cron이 월 1회뿐이라 그 달 등록이 통째로/부분 누락된다.
        print(f"{month} Doc 부족({len(urls)}/2) — 데일리 지연/미생성 가능 → 리마인더 폴백")
        sys.exit(1)
    storage = os.environ.get("NOTEBOOKLM_STORAGE")
    _diagnose_state(storage)
    # notebooklm-py 0.7.3: `async with`로 진입해야 HTTP 커널이 초기화된다. 예전
    # `client = await from_storage(...)` 형태는 커널 미초기화로 add_url 시
    # "Client not initialized"로 죽었다(진단 로그가 인증 성패를 가리는 원인이었음).
    async with NotebookLMClient.from_storage(storage) as client:
        for url in urls:
            await client.sources.add_url(nb_id, url, wait=True)
            print(f"등록 완료: {url}")


asyncio.run(main())
