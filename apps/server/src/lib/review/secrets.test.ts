import { describe, expect, it } from 'vitest';
import { redactField, scanSecrets } from './secrets.js';

const token = 'AbCdEf0123456789AbCdEf0123456789AbCdEf12';
const tunnel = Buffer.from(JSON.stringify({ a: 'account-123456789', t: 'tunnel-123456789', s: token })).toString('base64');
const planted = [
  ['github-token', `ghp_${token}`], ['github-token', `github_pat_${token.repeat(2)}`],
  ['gitlab-token', `glpat-${token}`], ['cloudflare-api-token', `cfat_${token}`],
  ['aws-access-key', 'AKIA1234567890ABCDEF'], ['aws-access-key', 'ASIA1234567890ABCDEF'],
  ['ai-api-key', `sk-${token}`], ['ai-api-key', `sk-ant-api03-${token}`],
  ['slack-token', `xoxb-${token}`], ['stripe-key', `rk_live_${token}`],
  ['jwt', `eyJ${token}.${token}.${token}`], ['cloudflare-tunnel-token', tunnel],
  ['private-key', `-----BEGIN RSA PRIVATE KEY-----\n${token}\n-----END RSA PRIVATE KEY-----`],
] as const;

describe('secret detection', () => {
  it.each(planted)('finds %s without exposing its value', (rule, secret) => {
    const text = `🙂 Credentials: ${secret} done`;
    const findings = scanSecrets({ content: text });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule, field: 'content', start: text.indexOf(secret), end: text.indexOf(secret) + secret.length, length: secret.length });
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(redactField(text, findings)).toBe('🙂 Credentials: [REDACTED] done');
  });

  it('redacts only assignment values and URL credentials, including quoted passwords', () => {
    const text = 'password="space rich secret" token=Qwerty1234; пароль: секрет123 https://alice:password123@host';
    const findings = scanSecrets({ content: text });
    expect(findings).toHaveLength(4);
    expect(redactField(text, findings)).toBe('password="[REDACTED]" token=[REDACTED]; пароль: [REDACTED] https://[REDACTED]@host');
    for (const secret of ['space rich secret', 'Qwerty1234', 'секрет123', 'alice:password123']) expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it('recognizes environment variable assignments and Russian keyword context', () => {
    const value = 'a12b34c56d78e90f1234567890abcdefab';
    for (const name of ['AWS_SECRET_ACCESS_KEY', 'DB_PASSWORD', 'SERVICE_TOKEN']) {
      const text = `${name}=${value}`;
      expect(redactField(text, scanSecrets({ content: text }))).toBe(`${name}=[REDACTED]`);
    }
    expect(scanSecrets({ content: `пароль хранится здесь ${value}` })[0]?.rule).toBe('keyword-entropy');
  });

  it('requires a nearby keyword and entropy for generic strings', () => {
    const high = 'a12b34c56d78e90f1234567890abcdefab';
    expect(scanSecrets({ content: `Commit ${high}` })).toEqual([]);
    expect(scanSecrets({ content: `secret is ${high}` })[0]?.rule).toBe('keyword-entropy');
    expect(scanSecrets({ content: `secret ${'a'.repeat(40)}` })).toEqual([]);
    expect(scanSecrets({ content: `secret ${' '.repeat(41)}${high}` })).toEqual([]);
    expect(scanSecrets({ content: 'token 12345678-1234-4234-8234-123456789abc' })).toEqual([]);
  });

  it.each(['your-api-key', 'your_api_key', 'xxx', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', '<token>', '${TOKEN}', '***', 'example', 'sk-...', 'sk-ant-...', '[REDACTED]', 'ghp_' + 'x'.repeat(36)])('excludes placeholder %s', (placeholder) => {
    expect(scanSecrets({ content: `token=${placeholder}` })).toEqual([]);
  });

  it('excludes URL examples and scans all three fields with nonoverlapping spans', () => {
    expect(scanSecrets({ content: 'https://user:password@example.com' })).toEqual([]);
    const key = `ghp_${token}`;
    const findings = scanSecrets({ content: `token=${key}`, concept: key, summary: key });
    expect(findings.map((f) => f.field).sort()).toEqual(['concept', 'content', 'summary']);
    expect(findings.every((f) => f.rule === 'github-token')).toBe(true);
    expect(redactField(`token=${key}`, findings.filter((f) => f.field === 'content'))).toBe('token=[REDACTED]');
  });

  it('covers incomplete private keys and rejects unrelated base64 JSON', () => {
    const text = '-----BEGIN PRIVATE KEY-----\nnever show this';
    expect(redactField(text, scanSecrets({ content: text }))).toBe('[REDACTED]');
    const data = Buffer.from(JSON.stringify({ description: token.repeat(3) })).toString('base64');
    expect(scanSecrets({ content: `${data} eyJ${token.repeat(3)}` })).toEqual([]);
  });
});
