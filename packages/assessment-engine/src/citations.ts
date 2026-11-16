export interface CitedClaim {
  /** Where the claim sits in the output, for the error message, e.g. "sentences.2.citations". */
  path: string;
  citations: readonly string[];
}

/** Every citation that is not one of the allowed ids, in order, without repeats. */
export function findUnknownCitations(
  citations: Iterable<string>,
  allowed: ReadonlySet<string>,
): string[] {
  const unknown: string[] = [];
  for (const citation of citations) {
    if (!allowed.has(citation) && !unknown.includes(citation)) unknown.push(citation);
  }
  return unknown;
}

/**
 * Check that a model's claims only cite evidence that was actually supplied.
 * Returns one readable problem per unknown citation (empty when everything checks out),
 * ready to feed back to the model for a correction attempt.
 */
export function validateCitations(
  claims: readonly CitedClaim[],
  allowed: ReadonlySet<string>,
): string[] {
  return claims.flatMap((claim) =>
    claim.citations
      .filter((citation) => !allowed.has(citation))
      .map(
        (citation) =>
          `${claim.path}: "${String(citation)}" is not one of the allowed evidence IDs`,
      ),
  );
}
