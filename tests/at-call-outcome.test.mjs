import { describe, expect, it } from "vitest";

const { readCallOutcome, safeReason } = await import("../lib/external-mcp/voice.ts");

describe("reading Africa's Talking's /call reply", () => {
  it("accepts a queued call and keeps its session id", () => {
    const reply = JSON.stringify({
      entries: [{ phoneNumber: "+254700000001", status: "Queued", sessionId: "ATVId_abc123" }],
      errorMessage: "None",
    });
    expect(readCallOutcome(reply)).toEqual({ refused: false, sessionId: "ATVId_abc123" });
  });

  it("treats a 200 reply that did not queue the call as a refusal, with the reason", () => {
    const reply = JSON.stringify({
      entries: [{ phoneNumber: "+254700000001", status: "InsufficientCredit", sessionId: "None" }],
      errorMessage: "None",
    });
    expect(readCallOutcome(reply)).toEqual({ refused: true, reason: "InsufficientCredit", sessionId: null });
  });

  it("uses the top-level error when there are no entries", () => {
    const reply = JSON.stringify({ entries: [], errorMessage: "Invalid callerId: +254711000000" });
    const outcome = readCallOutcome(reply);
    expect(outcome.refused).toBe(true);
    expect(outcome.reason).toBe("Invalid callerId: …");
  });

  it("does not invent a refusal from an unreadable body", () => {
    expect(readCallOutcome("not json")).toEqual({ refused: false, sessionId: null });
  });

  it("never lets a phone number into a stored reason", () => {
    expect(safeReason("Rejected +254707028159 <b>bad</b>")).toBe("Rejected … b bad b");
  });
});
