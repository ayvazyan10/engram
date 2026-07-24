import { describe, it, expect } from 'vitest';
import { extractUserQuery, injectContext, buildRetryBody } from '../messages.js';

describe('extractUserQuery', () => {
  it('takes the LAST user message', () => {
    const body = {
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ],
    };
    expect(extractUserQuery(body)).toBe('second');
  });

  it('flattens multimodal content to its text parts', () => {
    const body = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'describe' }, { type: 'image_url' }, { type: 'text', text: 'this' }] },
      ],
    };
    expect(extractUserQuery(body)).toBe('describe  this');
  });

  it('falls back to the /api/generate prompt field', () => {
    expect(extractUserQuery({ prompt: 'generate this' })).toBe('generate this');
  });

  it('returns empty when there is no user message', () => {
    expect(extractUserQuery({ messages: [{ role: 'system', content: 'x' }] })).toBe('');
    expect(extractUserQuery({})).toBe('');
  });
});

describe('injectContext', () => {
  const CONTEXT = 'MEMORY CONTEXT';

  it('returns the body untouched when there is no context', () => {
    const body = { messages: [{ role: 'user', content: 'hi' }] };
    expect(injectContext(body, '')).toBe(body);
  });

  it('appends to an existing string system message', () => {
    const body = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hi' },
      ],
    };
    const out = injectContext(body, CONTEXT) as typeof body;
    expect(out.messages[0]!.content).toBe(`You are helpful.\n\n${CONTEXT}`);
    expect(out.messages[1]!.content).toBe('hi');
  });

  it('prepends a system message when none exists', () => {
    const body = { messages: [{ role: 'user', content: 'hi' }] };
    const out = injectContext(body, CONTEXT) as { messages: Array<{ role: string; content: string }> };
    expect(out.messages[0]).toEqual({ role: 'system', content: CONTEXT });
    expect(out.messages).toHaveLength(2);
  });

  it('appends a text PART to multimodal system content instead of stringifying it', () => {
    const body = {
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
        { role: 'user', content: 'hi' },
      ],
    };
    const out = injectContext(body, CONTEXT) as { messages: Array<{ content: unknown }> };
    const systemContent = out.messages[0]!.content as Array<{ type: string; text?: string }>;

    expect(Array.isArray(systemContent)).toBe(true);
    expect(systemContent).toHaveLength(2);
    expect(systemContent[1]).toEqual({ type: 'text', text: CONTEXT });
    // The old implementation produced this:
    expect(JSON.stringify(out)).not.toContain('[object Object]');
  });

  it('appends to the /api/generate system field', () => {
    expect(injectContext({ system: 'base' }, CONTEXT)).toEqual({ system: `base\n\n${CONTEXT}` });
    expect(injectContext({ prompt: 'x' }, CONTEXT)).toEqual({ prompt: 'x', system: CONTEXT });
  });

  it('does not mutate the input body', () => {
    const body = { messages: [{ role: 'system', content: 'orig' }] };
    injectContext(body, CONTEXT);
    expect(body.messages[0]!.content).toBe('orig');
  });
});

describe('buildRetryBody', () => {
  it('appends the assistant text and an explicit tool instruction', () => {
    const original = { model: 'x', messages: [{ role: 'user', content: 'do it' }], tools: [{ name: 't' }] };
    const out = buildRetryBody(original, 'I cannot') as typeof original;

    expect(out.model).toBe('x');
    expect(out.tools).toEqual([{ name: 't' }]);
    expect(out.messages).toHaveLength(3);
    expect(out.messages[1]).toEqual({ role: 'assistant', content: 'I cannot' });
    expect(out.messages[2]!.role).toBe('user');
    expect(out.messages[2]!.content).toMatch(/must call one of the provided tools/i);
  });

  it('tolerates a body with no messages array', () => {
    const out = buildRetryBody({ prompt: 'x' }, 'text') as { messages: unknown[] };
    expect(out.messages).toHaveLength(2);
  });
});
