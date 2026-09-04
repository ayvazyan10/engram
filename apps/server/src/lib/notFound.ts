/**
 * Recognise core's "this memory does not exist / is out of namespace" error.
 *
 * NeuralBrain signals a missing memory by throwing a plain Error — there is no
 * error class or code to switch on — and it phrases the message two ways:
 * `Memory <id> not found` (addTag, removeTag, checkContradictions) and
 * `Memory not found: <id>` (forget, isolated mode only).
 *
 * Route handlers were therefore doing one of two wrong things: letting it
 * escape as a 500 (the tag routes), or catching EVERYTHING and calling it a
 * 404 (POST /api/contradictions/check/:id, which mapped a genuine internal
 * failure to "not found" as well). Matching the message here is narrow and
 * explicit, and anything unrecognised stays a 500 as it should.
 *
 * Deliberately does NOT match `Memory <id> has no embedding`: that memory
 * exists, so the answer is not 404.
 */
const MEMORY_NOT_FOUND = /^Memory (?:.+ not found|not found: .+)$/;

export function isMemoryNotFound(err: unknown): boolean {
  return err instanceof Error && MEMORY_NOT_FOUND.test(err.message);
}
