import { describe, it, expect } from 'vitest';
import { parseTagLabel, TAG_ID_STUB_LENGTH, TAG_VALUE_MAX_LENGTH } from '../tagLabel.js';

// The fixtures below are the project owner's real tags, pasted verbatim out
// of his own database. They are written by an agent orchestration system:
// colon-namespaced, and half of each one is an opaque cuid.
describe('parseTagLabel — the real tags from the inspector', () => {
  it('leaves a plain short tag entirely alone', () => {
    expect(parseTagLabel('mc')).toEqual({
      full: 'mc', prefix: '', value: 'mc', shortened: false, emphasis: 'value',
    });
    expect(parseTagLabel('pinned')).toEqual({
      full: 'pinned', prefix: '', value: 'pinned', shortened: false, emphasis: 'value',
    });
  });

  it('splits a namespace off and keeps a readable final segment intact', () => {
    expect(parseTagLabel('mc:outcome:DONE')).toEqual({
      full: 'mc:outcome:DONE', prefix: 'mc:outcome:', value: 'DONE', shortened: false, emphasis: 'value',
    });
    expect(parseTagLabel('mc:agent:shizu')).toEqual({
      full: 'mc:agent:shizu', prefix: 'mc:agent:', value: 'shizu', shortened: false, emphasis: 'value',
    });
  });

  it('drops an opaque cuid to a short stub and moves the emphasis onto the namespace', () => {
    // The reader can never read `cmtkeuc21004uuomwb6wai65r`; what they can
    // read — and what has to survive at a glance — is "this is a task tag".
    expect(parseTagLabel('mc:task:cmtkeuc21004uuomwb6wai65r')).toEqual({
      full: 'mc:task:cmtkeuc21004uuomwb6wai65r',
      prefix: 'mc:task:',
      value: 'cmtkeu…',
      shortened: true,
      emphasis: 'prefix',
    });
    expect(parseTagLabel('mc:project:cmtkdlvnh000f14i65csjhm2r')).toEqual({
      full: 'mc:project:cmtkdlvnh000f14i65csjhm2r',
      prefix: 'mc:project:',
      value: 'cmtkdl…',
      shortened: true,
      emphasis: 'prefix',
    });
  });

  it('stubs the id to exactly TAG_ID_STUB_LENGTH characters plus an ellipsis', () => {
    const { value } = parseTagLabel('mc:task:cmtkeuc21004uuomwb6wai65r');
    expect(value).toHaveLength(TAG_ID_STUB_LENGTH + 1);
    expect(value.endsWith('…')).toBe(true);
  });
});

describe('parseTagLabel — the opaque-id heuristic', () => {
  it('treats a canonical UUID as opaque', () => {
    const parts = parseTagLabel('run:550e8400-e29b-41d4-a716-446655440000');
    expect(parts.shortened).toBe(true);
    expect(parts.emphasis).toBe('prefix');
  });

  it('does not mistake a long readable word for an id — no digits means it is language', () => {
    const parts = parseTagLabel('area:internationalization');
    expect(parts.value).toBe('internationalization');
    expect(parts.shortened).toBe(false);
    expect(parts.emphasis).toBe('value');
  });

  it('does not mistake a hyphenated human label for an id even with digits in it', () => {
    const parts = parseTagLabel('plan:refactor-2024-q3');
    expect(parts.value).toBe('refactor-2024-q3');
    expect(parts.shortened).toBe(false);
    expect(parts.emphasis).toBe('value');
  });

  it('does not treat a short mixed token as an id — a cuid is never 5 characters', () => {
    expect(parseTagLabel('v2beta').shortened).toBe(false);
  });
});

describe('parseTagLabel — degenerate input', () => {
  it('caps an extremely long single word with no separator', () => {
    const monster = 'supercalifragilisticexpialidociousandthensome';
    const parts = parseTagLabel(monster);
    expect(parts.prefix).toBe('');
    expect(parts.value).toHaveLength(TAG_VALUE_MAX_LENGTH);
    expect(parts.value.endsWith('…')).toBe(true);
    expect(parts.shortened).toBe(true);
    // The untruncated tag is still carried, so the chip's title and the
    // remove control's accessible name stay exact.
    expect(parts.full).toBe(monster);
  });

  it('survives an empty tag', () => {
    expect(parseTagLabel('')).toEqual({
      full: '', prefix: '', value: '', shortened: false, emphasis: 'value',
    });
  });

  it('survives a whitespace-only tag', () => {
    const parts = parseTagLabel('   ');
    expect(parts.value).toBe('');
    expect(parts.prefix).toBe('');
    // `full` stays byte-exact — it is what removal is keyed on.
    expect(parts.full).toBe('   ');
  });

  it('survives a trailing-colon tag by putting the weight on the namespace', () => {
    expect(parseTagLabel('mc:')).toEqual({
      full: 'mc:', prefix: 'mc:', value: '', shortened: false, emphasis: 'prefix',
    });
  });

  it('survives a bare colon', () => {
    const parts = parseTagLabel(':');
    expect(parts.prefix).toBe(':');
    expect(parts.value).toBe('');
  });

  it('trims display whitespace but never the stored value', () => {
    const parts = parseTagLabel('  pinned  ');
    expect(parts.value).toBe('pinned');
    expect(parts.full).toBe('  pinned  ');
  });
});
