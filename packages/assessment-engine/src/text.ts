/** Lower-case, collapse whitespace, trim. The one normaliser every comparison uses. */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
