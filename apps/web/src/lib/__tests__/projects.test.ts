import { describe, it, expect } from 'vitest';
import { projectLabel } from '../projects.js';

describe('projectLabel', () => {
  it('names a project by its git root folder, and a memory without one Global', () => {
    expect(projectLabel('/home/me/code/api', ['/home/me/code/api', null])).toBe('api');
    expect(projectLabel('/home/me/code/api/', [])).toBe('api');
    expect(projectLabel('C:\\Users\\me\\api', [])).toBe('api');
    expect(projectLabel(null, [])).toBe('Global');
    expect(projectLabel(undefined, [])).toBe('Global');
  });

  it('adds the parent folder when two projects share a folder name', () => {
    const known = ['/home/me/work/api', '/home/me/play/api', '/home/me/code/web'];
    expect(projectLabel('/home/me/work/api', known)).toBe('work/api');
    expect(projectLabel('/home/me/play/api', known)).toBe('play/api');
    expect(projectLabel('/home/me/code/web', known)).toBe('web');
  });
});
