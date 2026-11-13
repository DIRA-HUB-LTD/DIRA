import "server-only";

import { after } from "next/server";
import type { LogObservationContext } from "@/lib/db/schema";
import type { ProfileAgentTrigger } from "@/lib/agent/profile-update-agent";

/**
 * Run the profile-update agent in the background after the response is sent,
 * when DIRA_PROFILE_AGENT_AUTO=true. Off by default so model cost is opt-in.
 * The teacher can always run it on demand from the evidence page.
 */
export function scheduleProfileUpdate(
  learnerId: string,
  context: LogObservationContext,
  trigger: Exclude<ProfileAgentTrigger, "manual">,
): boolean {
  if (process.env.DIRA_PROFILE_AGENT_AUTO !== "true") return false;
  after(async () => {
    try {
      const { runProfileUpdateAgent } = await import("@/lib/agent/profile-update-agent");
      await runProfileUpdateAgent(learnerId, context, { trigger });
    } catch (error) {
      console.error("Background profile update failed", {
        trigger,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  });
  return true;
}
