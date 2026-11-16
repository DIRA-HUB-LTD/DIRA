export { normalizeText } from "./text";
export {
  corroborate,
  groupByCategory,
  uniqueById,
  DEFAULT_CORROBORATION,
  type CorroborationConfig,
  type CorroborationSignal,
  type EvidenceItem,
  type GroupSummary,
} from "./corroboration";
export { fingerprint } from "./fingerprint";
export { findUnknownCitations, validateCitations, type CitedClaim } from "./citations";
export { verifyExcerpt } from "./excerpt";
export {
  generateValidated,
  GenerationFailedError,
  type GenerateValidatedOptions,
  type Validation,
} from "./generate-validated";
