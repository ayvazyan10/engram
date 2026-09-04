/**
 * Tag label parsing for the memory inspector's tag row.
 *
 * The tags this dashboard actually receives are written by agent
 * orchestration systems, not typed by a human:
 *
 *   mc                                   plain
 *   mc:task:cmtkeuc21004uuomwb6wai65r    namespace + opaque cuid
 *   mc:outcome:DONE                      namespace + readable value
 *   mc:agent:shizu                       namespace + readable value
 *
 * Rendering every one of those at one weight, in a 220px-wide column, is
 * what made the tag row unreadable: `cmtkeuc21004uuomwb6wai65r` is a
 * database key no reader will ever read, and it was crowding out the half
 * of the tag that says what the tag *is*.
 *
 * The rule here is **emphasis follows information**. A tag is split at its
 * last colon into a namespace and a final segment, and whichever of those
 * two a human can actually read gets the visual weight:
 *
 *   - readable final segment (`DONE`, `shizu`) -> the segment is the point,
 *     the namespace recedes.
 *   - opaque final segment (a cuid/uuid) -> the segment is noise, so it is
 *     cut to a short stub and the namespace (`mc:task:`) carries the weight
 *     instead. The tag still reads as "a task tag" at a glance.
 *
 * Nothing here is ever the last line of defence against overflow — the chip
 * also hard-truncates with a CSS ellipsis (see NeuronInspector's
 * `styles.tagLabel`), and the untouched tag stays reachable through the
 * chip's `title` and the remove control's accessible name.
 */

/** Characters of an opaque id kept before the ellipsis. Six is enough to
 *  tell two cuids apart at a glance and to grep a log for, without
 *  pretending the rest of it is readable. */
export const TAG_ID_STUB_LENGTH = 6;

/** Hard cap on any displayed final segment, ellipsis included. The backstop
 *  for a pathological tag that is one long unbroken word — CSS still clips
 *  it visually, this keeps the rendered text bounded too. */
export const TAG_VALUE_MAX_LENGTH = 24;

const ELLIPSIS = '…';

/** cuid / cuid2 / nanoid shape: an unbroken lowercase alphanumeric run of
 *  12+ characters mixing letters and digits. Deliberately does NOT match a
 *  hyphenated or uppercase token — `refactor-2024-q3` and `DONE` are things
 *  somebody chose to write, and the generators actually in play here all
 *  emit lowercase without separators. */
const CUID_LIKE = /^(?=.*[0-9])(?=.*[a-z])[a-z0-9]{12,}$/;

/** Canonical 8-4-4-4-12 UUID. */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isOpaqueId(segment: string): boolean {
  return CUID_LIKE.test(segment) || UUID_LIKE.test(segment);
}

function clampSegment(segment: string): string {
  if (segment.length <= TAG_VALUE_MAX_LENGTH) return segment;
  return segment.slice(0, TAG_VALUE_MAX_LENGTH - ELLIPSIS.length) + ELLIPSIS;
}

export interface TagLabelParts {
  /** The tag exactly as stored, untrimmed and unshortened. This is what the
   *  chip's `title`, the remove control's accessible name, and the removal
   *  request itself are keyed on — display shortening must never leak into
   *  any of the three. */
  full: string;
  /** The namespace, including its trailing ':'. '' when the tag has none. */
  prefix: string;
  /** Display form of the final segment. May be a stub or clamped. */
  value: string;
  /** True when `value` is not the whole final segment. */
  shortened: boolean;
  /** Which half carries the meaning, and so gets the weight. */
  emphasis: 'prefix' | 'value';
}

/** Split one tag into the parts the chip renders. Pure; safe on any string,
 *  including '' and ':'. */
export function parseTagLabel(tag: string): TagLabelParts {
  const trimmed = tag.trim();
  const lastColon = trimmed.lastIndexOf(':');
  const prefix = lastColon === -1 ? '' : trimmed.slice(0, lastColon + 1);
  const segment = lastColon === -1 ? trimmed : trimmed.slice(lastColon + 1);

  const opaque = isOpaqueId(segment);
  const value = opaque ? segment.slice(0, TAG_ID_STUB_LENGTH) + ELLIPSIS : clampSegment(segment);

  // The namespace only takes the weight when it is genuinely the readable
  // half — an opaque id, or a tag that ends at its colon. With no namespace
  // there is nothing to promote, so the segment keeps it.
  const emphasis: 'prefix' | 'value' =
    prefix !== '' && (opaque || segment === '') ? 'prefix' : 'value';

  return { full: tag, prefix, value, shortened: value !== segment, emphasis };
}
