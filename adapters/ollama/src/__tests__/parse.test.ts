/**
 * The Ollama proxy had zero test coverage while carrying real bugs. These lock
 * in the response-parsing contract, including the NDJSON aggregation defect that
 * silently disabled the proxy's headline auto-store feature.
 */

import { describe, it, expect } from 'vitest';
import { parseOllamaResponse, parseOpenAIResponse } from '../parse.js';

describe('parseOllamaResponse', () => {
  it('aggregates text across all NDJSON chunks (the streaming default)', () => {
    // Ollama streams by default and the terminal {done:true} chunk is EMPTY —
    // reading only the last line yielded '' and auto-store never fired.
    const body = [
      JSON.stringify({ message: { content: 'Hello' }, done: false }),
      JSON.stringify({ message: { content: ' world' }, done: false }),
      JSON.stringify({ message: { content: '' }, done: true }),
    ].join('\n');

    const parsed = parseOllamaResponse(body);
    expect(parsed.text).toBe('Hello world');
    expect(parsed.finishReason).toBe('stop');
  });

  it('aggregates the /api/generate `response` field too', () => {
    const body = [
      JSON.stringify({ response: 'foo', done: false }),
      JSON.stringify({ response: 'bar', done: true }),
    ].join('\n');

    expect(parseOllamaResponse(body).text).toBe('foobar');
  });

  it('handles a single non-streaming object', () => {
    const body = JSON.stringify({ message: { content: 'One shot' }, done: true });
    const parsed = parseOllamaResponse(body);
    expect(parsed.text).toBe('One shot');
    expect(parsed.finishReason).toBe('stop');
  });

  it('detects tool calls in any chunk, not just the last', () => {
    const body = [
      JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'x' } }] }, done: false }),
      JSON.stringify({ message: { content: '' }, done: true }),
    ].join('\n');

    expect(parseOllamaResponse(body).hasToolCalls).toBe(true);
  });

  it('skips malformed lines without losing the rest', () => {
    const body = [
      JSON.stringify({ message: { content: 'good' }, done: false }),
      '{ not json',
      JSON.stringify({ message: { content: ' tail' }, done: true }),
    ].join('\n');

    expect(parseOllamaResponse(body).text).toBe('good tail');
  });

  it('returns empty for an empty body', () => {
    expect(parseOllamaResponse('')).toEqual({ text: '', hasToolCalls: false, finishReason: '' });
  });
});

describe('parseOpenAIResponse', () => {
  it('concatenates SSE deltas and reads the finish reason', () => {
    const body = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
    ].join('\n');

    const parsed = parseOpenAIResponse(body);
    expect(parsed.text).toBe('Hello');
    expect(parsed.finishReason).toBe('stop');
  });

  it('detects streamed tool calls', () => {
    const body = `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0 }] }, finish_reason: 'tool_calls' }],
    })}`;

    const parsed = parseOpenAIResponse(body);
    expect(parsed.hasToolCalls).toBe(true);
    expect(parsed.finishReason).toBe('tool_calls');
  });

  it('parses a non-streaming completion', () => {
    const body = JSON.stringify({
      choices: [{ message: { content: 'Plain answer' }, finish_reason: 'stop' }],
    });

    const parsed = parseOpenAIResponse(body);
    expect(parsed.text).toBe('Plain answer');
    expect(parsed.hasToolCalls).toBe(false);
    expect(parsed.finishReason).toBe('stop');
  });

  it('detects tool calls in a non-streaming completion', () => {
    const body = JSON.stringify({
      choices: [{ message: { content: '', tool_calls: [{ id: 'a' }] }, finish_reason: 'tool_calls' }],
    });
    expect(parseOpenAIResponse(body).hasToolCalls).toBe(true);
  });

  it('returns empty on unparseable input', () => {
    expect(parseOpenAIResponse('<html>502</html>')).toEqual({
      text: '', hasToolCalls: false, finishReason: '',
    });
  });
});
