export type Validation<T> = { ok: true; value: T } | { ok: false; problems: string[] };

export interface GenerateValidatedOptions<T> {
  /**
   * Ask the model. `previousProblems` is empty on the first attempt; on the correction
   * attempt it holds what was wrong, so the caller can tell the model.
   * Errors thrown here (model down, network) are NOT retried: they propagate.
   */
  generate(request: { attempt: number; previousProblems: string[] }): Promise<string | null>;
  /** Turn the model's raw text into a valid value, or list what is wrong with it. */
  validate(raw: string | null): Validation<T>;
  /** Called after every invalid attempt, e.g. to log it. */
  onInvalid?(info: { attempt: number; problems: string[] }): unknown;
  /** Total attempts including the first. Default 2: one try plus one correction. */
  maxAttempts?: number;
}

/** The model never produced valid output. Nothing was accepted. */
export class GenerationFailedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly problems: string[],
  ) {
    super(`The model did not produce valid output after ${attempts} attempt(s).`);
    this.name = "GenerationFailedError";
  }
}

/**
 * Generate, validate, and retry once with feedback. If it still fails, fail closed:
 * throw, never return unvalidated output.
 */
export async function generateValidated<T>(options: GenerateValidatedOptions<T>): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 2;
  let problems: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const raw = await options.generate({ attempt, previousProblems: problems });
    const result = options.validate(raw);
    if (result.ok) return result.value;
    problems = result.problems;
    await options.onInvalid?.({ attempt, problems });
  }
  throw new GenerationFailedError(maxAttempts, problems);
}
