/**
 * `engram cloud encrypt <passphrase>` took the key that decrypts every synced
 * memory on argv — so it landed in shell history and in `ps` — and then printed
 * it back twice in the "how to keep using it" instructions.
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import {
  choosePassphraseSource,
  passphraseWarning,
  readHiddenLine,
  encryptionInstructions,
  PASSPHRASE_ENV,
} from '../passphrase.js';

describe('choosePassphraseSource', () => {
  it('still accepts an argument, because scripts already pass one', () => {
    expect(choosePassphraseSource('hunter2', {}, true)).toEqual({ kind: 'argv', value: 'hunter2' });
  });

  it('prefers the environment variable over prompting', () => {
    expect(choosePassphraseSource(undefined, { [PASSPHRASE_ENV]: 'from-env' }, true))
      .toEqual({ kind: 'env', value: 'from-env' });
  });

  it('prompts when there is a terminal and nothing else', () => {
    expect(choosePassphraseSource(undefined, {}, true)).toEqual({ kind: 'prompt' });
  });

  it('gives up rather than guessing when there is no terminal to ask', () => {
    expect(choosePassphraseSource(undefined, {}, false)).toEqual({ kind: 'unavailable' });
    expect(choosePassphraseSource('', { [PASSPHRASE_ENV]: '' }, false)).toEqual({ kind: 'unavailable' });
  });
});

describe('passphraseWarning', () => {
  it('warns that an argv passphrase is now in the shell history', () => {
    const warning = passphraseWarning({ kind: 'argv', value: 'hunter2' }).join(' ');
    expect(warning).toMatch(/shell history/);
    expect(warning).toMatch(/ps/);
    // The warning must not repeat the secret it is warning about.
    expect(warning).not.toContain('hunter2');
  });

  it('says nothing for the safe sources', () => {
    expect(passphraseWarning({ kind: 'env', value: 'x' })).toEqual([]);
    expect(passphraseWarning({ kind: 'prompt' })).toEqual([]);
  });
});

describe('encryptionInstructions', () => {
  it('never contains a passphrase — it takes none', () => {
    const text = encryptionInstructions().join('\n');
    expect(text).toContain(PASSPHRASE_ENV);
    expect(text).toContain('your passphrase');
    expect(text).toMatch(/never printed/i);
  });
});

describe('readHiddenLine', () => {
  it('returns the line without echoing a single character of it', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));

    const pending = readHiddenLine('Passphrase: ', input, output);
    input.write('correct horse battery\n');

    expect(await pending).toBe('correct horse battery');

    const echoed = written.join('');
    expect(echoed).toContain('Passphrase: ');
    expect(echoed).not.toContain('correct horse battery');
    expect(echoed).not.toContain('correct');
  });
});
