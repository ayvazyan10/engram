/**
 * Plain-text rendering of memory/reflection bodies (H4, H1).
 *
 * Everything this dashboard displays as a "concept" or a "body" arrives as
 * Markdown written by an LLM — the reflection writer emits headings and bold
 * runs, and so does anything stored through `store_reflection`. Every surface
 * printed that source verbatim, so cards opened with a literal
 * `# Memory Analysis: … **Most Significant Contradiction:**`.
 *
 * Deliberately NOT a Markdown renderer: the bundle is already over budget and
 * nothing here needs rich text. This strips the syntax that leaks through and
 * leaves the words, which is all these one-to-three-line surfaces can show
 * anyway.
 *
 * Only `*`-flavoured emphasis is unwrapped. `_`-flavoured emphasis is left
 * alone on purpose: `some_snake_case_name` would otherwise be mangled into
 * `somesnakecasename`, and the writers in play here all use asterisks.
 */

/** Fenced code blocks: drop the fence + info string, keep the code. */
const FENCE = /```[a-zA-Z0-9+#.-]*\r?\n?/g;
/** ATX heading marker at the start of any line: `#` … `######` + space. */
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/gm;
/** `**bold**` → `bold`. */
const BOLD = /\*\*([^*]+)\*\*/g;
/** `*em*` → `em`. Single line only, so a stray asterisk can't swallow a
 *  paragraph. */
const EM = /\*([^*\n]+)\*/g;
/** `` `code` `` → `code`. */
const CODE = /`([^`\n]+)`/g;
const WHITESPACE = /\s+/g;

/**
 * Markdown source → one line of readable prose, whitespace collapsed.
 *
 * Total, not best-effort: safe on '' and on text that contains no Markdown at
 * all (in which case it is just a whitespace collapse).
 */
export function toPlainText(value: string): string {
  if (!value) return '';
  return value
    .replace(FENCE, ' ')
    .replace(HEADING, '')
    .replace(BOLD, '$1')
    .replace(EM, '$1')
    .replace(CODE, '$1')
    .replace(WHITESPACE, ' ')
    .trim();
}

/** Characters of `content` kept on a row that has no concept of its own.
 *  Unchanged from what the sidebar row always showed. */
export const CONTENT_SLICE_LENGTH = 40;

/** Upper bound on the second line. The row also clips with a CSS ellipsis —
 *  this only keeps the rendered string itself bounded. */
export const EXCERPT_MAX_LENGTH = 140;

/** Separators an LLM puts between a concept and the sentence that follows it,
 *  stripped along with the concept so the excerpt starts on a word. */
const LEADING_SEPARATORS = /^[\s:;,.\-—–|>»]+/;

export interface MemoryRowText {
  /** Line one: the concept, or a slice of the content when there is none. */
  primary: string;
  /** Line two: a distinct excerpt of the content, or the source. '' when the
   *  record has neither — the caller drops the line entirely. */
  secondary: string;
}

/**
 * The two lines a memory row shows (H1).
 *
 * The sidebar rendered `concept ?? content.slice(0, 40)` and a date, which
 * made 30% of 200 rows byte-identical to another row: `# Trend Analysis`
 * appeared 18 times, `# Knowledge Gap Analysis` 18, `# Pattern Analysis` 12,
 * and several of those shared a date too. The concept is the *category* of
 * these records, not their content, so it cannot be the only thing on the
 * row.
 *
 * With a concept: the concept leads, and the body follows on line two with
 * that same concept stripped off its front (the body almost always repeats it
 * as its heading) so the second line carries new information rather than
 * echoing the first.
 *
 * Without a concept: line one keeps the content slice it always showed, and
 * line two carries `source`, which is the only other thing that distinguishes
 * such a row.
 */
export function memoryRowText(record: {
  concept: string | null;
  content: string;
  source: string | null;
}): MemoryRowText {
  const body = toPlainText(record.content);
  const concept = toPlainText(record.concept ?? '');

  if (!concept) {
    return {
      primary: body.slice(0, CONTENT_SLICE_LENGTH),
      secondary: record.source ?? '',
    };
  }

  const excerpt = stripLeadingConcept(body, concept).slice(0, EXCERPT_MAX_LENGTH);
  return {
    primary: concept,
    secondary: excerpt || record.source || '',
  };
}

/** Drop a leading repeat of `concept` (and the punctuation gluing it to the
 *  sentence) from `body`. Case-insensitive: the heading is often title-cased
 *  where the concept is not. */
function stripLeadingConcept(body: string, concept: string): string {
  if (!concept) return body;
  if (body.slice(0, concept.length).toLowerCase() !== concept.toLowerCase()) return body;
  return body.slice(concept.length).replace(LEADING_SEPARATORS, '');
}
