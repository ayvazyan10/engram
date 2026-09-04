/**
 * How `engram cloud encrypt` gets the passphrase, and what it is allowed to
 * print afterwards.
 *
 * It took the passphrase as a command-line argument and then echoed it back
 * twice — `export ENGRAM_SYNC_ENCRYPTION_KEY="<passphrase>"` and
 * `ENGRAM_SYNC_ENCRYPTION_KEY="<passphrase>" engram start`. That put the key
 * that decrypts every synced memory into the shell history file, into `ps` for
 * every user on the machine while the command ran, and into the terminal
 * scrollback afterwards.
 *
 * The argument still works — scripts depend on it — but it warns, and it is no
 * longer the only way in: an interactive terminal is prompted with the echo
 * turned off, and automation can hand the value over in the environment.
 */

import readline from 'readline';

export const PASSPHRASE_ENV = 'ENGRAM_SYNC_ENCRYPTION_KEY';

export type PassphraseSource =
  | { kind: 'argv'; value: string }
  | { kind: 'env'; value: string }
  | { kind: 'prompt' }
  | { kind: 'unavailable' };

/**
 * Decide where the passphrase comes from.
 *
 * Order: an explicit argument (with a warning), then the environment variable
 * this command tells people to export anyway, then an interactive prompt.
 * Without a terminal there is nowhere left to ask, and guessing is not an
 * option — encryption initialised with the wrong key locks the data away.
 */
export function choosePassphraseSource(
  argvValue: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  isTty: boolean,
): PassphraseSource {
  if (argvValue !== undefined && argvValue.length > 0) return { kind: 'argv', value: argvValue };

  const fromEnv = env[PASSPHRASE_ENV];
  if (fromEnv !== undefined && fromEnv.length > 0) return { kind: 'env', value: fromEnv };

  return isTty ? { kind: 'prompt' } : { kind: 'unavailable' };
}

/** The warning an argv passphrase earns. Empty for every other source. */
export function passphraseWarning(source: PassphraseSource): readonly string[] {
  if (source.kind !== 'argv') return [];
  return [
    'The passphrase was passed as an argument — it is now in your shell history and was visible in `ps`.',
    `Prefer running \`engram cloud encrypt\` with no argument, or exporting ${PASSPHRASE_ENV}.`,
  ];
}

/**
 * Read a line without echoing it.
 *
 * readline writes every keystroke back to the output when `terminal: true`;
 * replacing `_writeToOutput` is the supported-in-practice way to suppress that
 * while keeping line editing and the final newline.
 */
export function readHiddenLine(
  promptText: string,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: input as NodeJS.ReadableStream & { isTTY?: boolean },
      output,
      terminal: true,
    });

    output.write(promptText);
    // Everything the user types is swallowed here; only the newline they end
    // the line with is echoed, so the cursor moves on.
    (rl as unknown as { _writeToOutput: (chunk: string) => void })._writeToOutput = (chunk: string) => {
      if (chunk.includes('\n') || chunk.includes('\r')) output.write('\n');
    };

    rl.on('error', (err) => { rl.close(); reject(err); });
    rl.question('', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * The instructions printed after a successful `cloud encrypt`, with the
 * passphrase itself left out.
 */
export function encryptionInstructions(): readonly string[] {
  return [
    'To enable encryption on every sync, export the passphrase (it is never printed here):',
    `  export ${PASSPHRASE_ENV}='your passphrase'`,
    '',
    'Or pass it when starting the server:',
    `  ${PASSPHRASE_ENV}='your passphrase' engram start`,
    '',
    '⚠️  Use the same passphrase on all devices.',
    '⚠️  If you lose the passphrase, encrypted data cannot be recovered.',
  ];
}
