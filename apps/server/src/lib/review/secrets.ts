/** Offsets are UTF-16 string indices into the original field; end is exclusive. */
export interface Finding {
  rule: string;
  field: 'content' | 'concept' | 'summary';
  start: number;
  end: number;
  length: number;
  preview: string;
}

const keyword = /(?<![\p{L}\p{N}])(?:password|passwd|passphrase|pass|secret|api[ _-]?key|token|access[ _-]?key|пароль)(?![\p{L}\p{N}])/iu;
const rules = [
  ['private-key', /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ['cloudflare-api-token', /\bcfat_[A-Za-z0-9]{30,}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['ai-api-key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['stripe-key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g],
  ['jwt', /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g],
] as const;
export const secretRuleNames = [...rules.map(([name]) => name), 'cloudflare-tunnel-token', 'url-credentials', 'keyword-assignment', 'keyword-entropy'];

function placeholder(value: string): boolean {
  return /^(?:<[^>]*>|\$\{[^}]*\}|\[REDACTED\]|\*+|x{3,}|your[-_].*|example(?:[-_].*)?|sk-(?:ant-)?\.{3})$/i.test(value)
    || /^(?:gh[pousr]_|github_pat_|glpat-|cfat_|sk-(?:ant-)?|[AR]KIA)(?:x{3,}|your[-_].*|example.*)$/i.test(value);
}

export function scanSecrets(memory: { content: string; concept?: string | null; summary?: string | null }): Finding[] {
  const findings: Finding[] = [];
  for (const field of ['content', 'concept', 'summary'] as const) {
    const text = memory[field] ?? '';
    const add = (rule: string, start: number, value: string) => {
      const end = start + value.length;
      if (placeholder(value) || findings.some((f) => f.field === field && start < f.end && end > f.start)) return;
      // Only known public prefixes and a short suffix are exposed, never context.
      const prefix = value.match(/^(?:gh[pousr]_|github_pat_|glpat-|cfat_|sk-ant-|sk-|AKIA|ASIA|xox[abprs]-|[sr]k_live_)/)?.[0] ?? '';
      const preview = rule === 'private-key' || value.length < 12 ? '****' : `${prefix}****${value.slice(-4)}`;
      findings.push({ rule, field, start, end, length: value.length, preview });
    };
    for (const [rule, regex] of rules) {
      for (const match of text.matchAll(regex)) add(rule, match.index, match[0]);
    }
    // Tunnel tokens are base64 JSON credentials (a=account, t=tunnel, s=secret).
    for (const match of text.matchAll(/\beyJ[A-Za-z0-9+/=_-]{60,}/g)) {
      try {
        const decoded = JSON.parse(Buffer.from(match[0], 'base64').toString('utf8')) as Record<string, unknown>;
        if (typeof decoded.a === 'string' && typeof decoded.t === 'string' && typeof decoded.s === 'string') {
          add('cloudflare-tunnel-token', match.index, match[0]);
        }
      } catch { /* Other base64 strings are not tunnel credentials. */ }
    }
    for (const match of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^\s/:@]+):([^\s@]{3,})@/gi)) {
      if (match[1] === 'user' && match[2] === 'password') continue;
      const credentials = `${match[1]}:${match[2]}`;
      if (!placeholder(match[2]!)) add('url-credentials', match.index + match[0].indexOf('://') + 3, credentials);
    }
    for (const match of text.matchAll(/(?<![\p{L}\p{N}])(?:password|passwd|passphrase|pass|secret|api[ _-]?key|token|access[ _-]?key|пароль)(?![\p{L}\p{N}])\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s,;`]+))/giu)) {
      const value = match[1] ?? match[2] ?? match[3]!;
      if (value.length >= 6) add('keyword-assignment', match.index + match[0].lastIndexOf(value), value);
    }
    for (const match of text.matchAll(/[A-Za-z0-9+/_=-]{32,}/g)) {
      const value = match[0];
      if (/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) continue;
      const nearby = text.slice(Math.max(0, match.index - 40), match.index) + ' ' + text.slice(match.index + value.length, match.index + value.length + 40);
      if (!keyword.test(nearby)) continue;
      const counts = new Map<string, number>();
      for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
      const entropy = [...counts.values()].reduce((sum, n) => sum - n / value.length * Math.log2(n / value.length), 0);
      if (counts.size >= 10 && entropy >= 3.5) add('keyword-entropy', match.index, value);
    }
  }
  return findings.sort((a, b) => a.field.localeCompare(b.field) || a.start - b.start);
}

export function redactField(text: string, findings: Finding[]): string {
  for (const finding of [...findings].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, finding.start) + '[REDACTED]' + text.slice(finding.end);
  }
  return text;
}
