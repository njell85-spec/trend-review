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
    client = await NotebookLMClient.from_storage(os.environ.get("NOTEBOOKLM_STORAGE"))
    for url in urls:
        await client.sources.add_url(nb_id, url, wait=True)
        print(f"등록 완료: {url}")


asyncio.run(main())
