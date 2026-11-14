import { normalizeText } from "./text";

/**
 * True only when the excerpt really appears in the source, ignoring case and whitespace.
 * This is how a model-proposed quote is kept honest: if the words are not in the
 * original transcript, the excerpt is rejected.
 */
export function verifyExcerpt(excerpt: string, source: string): boolean {
  const wanted = normalizeText(excerpt);
  return wanted.length > 0 && normalizeText(source).includes(wanted);
}
