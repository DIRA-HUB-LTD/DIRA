import { describe, expect, it } from "vitest";
import {
  activeEducationSources,
  DIRA_USER_AGENT,
  EDUCATION_SOURCES,
} from "../lib/services/education-retrieval.ts";

describe("live education sources", () => {
  it("defaults to the sources that accept automated requests (AMI, WWC)", () => {
    expect(activeEducationSources({}).map((source) => source.key)).toEqual(["AMI", "WWC"]);
  });

  it("can be configured, ignoring unknown keys", () => {
    expect(
      activeEducationSources({ DIRA_EDUCATION_SOURCES: "wwc, EEF, NOPE" }).map((source) => source.key),
    ).toEqual(["EEF", "WWC"]);
  });

  it("falls back to the defaults when nothing valid is configured", () => {
    expect(activeEducationSources({ DIRA_EDUCATION_SOURCES: "NOPE" }).map((source) => source.key)).toEqual([
      "AMI",
      "WWC",
    ]);
  });

  it("keeps all four sources defined, so stored references still resolve", () => {
    expect(EDUCATION_SOURCES.map((source) => source.key)).toEqual(["IB", "EEF", "AMI", "WWC"]);
  });

  it("identifies DIRA honestly", () => {
    expect(DIRA_USER_AGENT).toMatch(/^DIRA-Education-Guidance\/\d/);
  });
});
