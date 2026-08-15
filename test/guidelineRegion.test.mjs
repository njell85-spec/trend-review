import test from 'node:test';
import assert from 'node:assert/strict';
import { regionFromTitle, resolveRegion } from '../src/utils/guidelineRegion.js';

// 발표 기관 기준 지역 판정. 저자 소속국·저널 발행국은 "누가 낸 지침이냐" 를 못 맞힌다 —
// 저널 발행국은 특히 출판사 주소(Elsevier=네덜란드, BMJ=영국)를 잡는다.

test('제목의 정식 기관명으로 잡는다', () => {
  assert.deepEqual(
    regionFromTitle('Part 11: Post-Cardiac Arrest Care: 2025 American Heart Association Guidelines for CPR'),
    { region: 'us', by: 'org-name' });
  assert.deepEqual(
    regionFromTitle('European Resuscitation Council Guidelines 2025: Adult advanced life support'),
    { region: 'eu', by: 'org-name' });
  assert.deepEqual(
    regionFromTitle('Korean Society of Critical Care Medicine guidelines on sedation'),
    { region: 'kr', by: 'org-name' });
});

test('약어로도 잡는다', () => {
  assert.equal(regionFromTitle('2024 ESC Guidelines for the management of atrial fibrillation').region, 'eu');
  assert.equal(regionFromTitle('ACEP clinical policy: procedural sedation').region, 'us');
  assert.equal(regionFromTitle('NICE guideline: sepsis recognition and early management').region, 'eu');
});

test('★ 약어는 대문자 경계로만 잡는다 — 일반 단어와 겹치면 안 된다', () => {
  // "acs" 는 acute coronary syndrome 의 약어이기도 하다. 소문자는 기관으로 안 본다.
  assert.equal(regionFromTitle('Management of acs in the emergency department'), null);
  // 단어 안에 묻힌 대문자열도 아니다.
  assert.equal(regionFromTitle('BAHAMAS trial protocol'), null);
});

test('기관명이 없으면 국적 형용사로 잡는다', () => {
  assert.deepEqual(regionFromTitle('German guidelines on polytrauma management'), { region: 'eu', by: 'nationality' });
  assert.deepEqual(regionFromTitle('Korean clinical practice guideline for stroke'), { region: 'kr', by: 'nationality' });
});

test('정식 기관명이 국적 형용사보다 우선한다', () => {
  // "European" 과 "American Heart Association" 이 같이 있으면 기관명이 이긴다.
  const r = regionFromTitle('European perspectives on the American Heart Association guidelines');
  assert.equal(r.by, 'org-name');
  assert.equal(r.region, 'us');
});

test('아무 단서도 없으면 null 이다', () => {
  assert.equal(regionFromTitle('Guidelines for the management of severe sepsis'), null);
  assert.equal(regionFromTitle(''), null);
  assert.equal(regionFromTitle(undefined), null);
});

test('폴백 순서: 제목 → 소속국 → 저널국', () => {
  assert.deepEqual(
    resolveRegion({ title: 'ESC Guidelines', affiliationRegion: 'us', journalRegion: 'us' }),
    { region: 'eu', by: 'org-acronym' }, '제목이 있으면 제목이 이긴다');
  assert.deepEqual(
    resolveRegion({ title: 'Guidelines for shock', affiliationRegion: 'us', journalRegion: 'eu' }),
    { region: 'us', by: 'affiliation' }, '제목이 없으면 소속국');
  assert.deepEqual(
    resolveRegion({ title: 'Guidelines for shock', affiliationRegion: null, journalRegion: 'eu' }),
    { region: 'eu', by: 'journal' }, '소속도 없으면 저널국');
});

test('★ 소속국이 그 외면 저널국으로 내려가되, 저널국도 그 외면 그 외로 남는다', () => {
  assert.deepEqual(
    resolveRegion({ title: 'Guidelines for shock', affiliationRegion: 'other', journalRegion: 'eu' }),
    { region: 'eu', by: 'journal' });
  assert.deepEqual(
    resolveRegion({ title: 'Guidelines for shock', affiliationRegion: 'other', journalRegion: 'other' }),
    { region: 'other', by: 'affiliation' });
});

test('단서가 전혀 없으면 판정 불가다 (임의로 채우지 않는다)', () => {
  assert.deepEqual(resolveRegion({ title: 'Guidelines for shock' }), { region: null, by: null });
});

test('★ 앞에 붙은 국적이 기관명 조각을 이긴다 (실측으로 걸린 버그)', () => {
  // "society of critical care medicine" 은 미국 SCCM 의 정식명인데,
  // "Korean Society of Critical Care Medicine" 안에 통째로 들어 있다.
  const r = regionFromTitle('Korean Society of Critical Care Medicine guidelines on sedation');
  assert.equal(r.region, 'kr', '한국 지침이 미국으로 잡히던 자리다');
  const r2 = regionFromTitle('European Society of Intensive Care Medicine guidelines');
  assert.equal(r2.region, 'eu');
  // 국적이 앞에 없으면 원래 기관 그대로다.
  assert.equal(regionFromTitle('Society of Critical Care Medicine guidelines').region, 'us');
});
