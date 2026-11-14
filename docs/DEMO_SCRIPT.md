# DIRA: 3-minute demo script (unedited agent run)

**Audience:** judges of the Agentic AI for Africa "The Long View" Education track.
**Rule we follow:** one continuous, unedited take that shows the agent working **and where it fails**. Synthetic data only.

## Before recording (not part of the 3 minutes)
1. `npm run demo` (prints the demo teacher ID and PIN). Set `ZAI_API_KEY` in `.env.local`, or a self-hosted model (`DIRA_MODEL_BASE_URL`, `DIRA_MODEL_NAME`) if you are showing the open-weights run.
2. Choose a learner whose evidence spans two school years and who has a completed test. Check on `/evidence/<id>` that **Sign this summary**, at the foot of the Evidence Card, says the gate is met.
3. Pick a learner with thin evidence for the failure moment.
4. Set `FETCH_MCP_ENABLED=false` for the run if you want the retrieval failure to appear on screen.
5. Open two tabs: `/this-week` and the learner's evidence page. Sign out, so the approval moment shows sign-in is required.

## The take

| Time | Show | Say (short) |
|---|---|---|
| 0:00–0:20 | `/this-week` | "Each fortnight a teacher gets 10 learners from *their* classes, quietest first. The list stays fixed, so nobody slips through." |
| 0:20–0:45 | A post-class call draft on `/call-drafts`, confirm it | "A teacher with a basic phone gets a call after class. DIRA transcribes it; the teacher confirms. Nothing counts until they do." |
| 0:45–1:05 | Learner record: observations labelled "earlier year" | "This Grade 4 teacher sees last year's Grade 3 evidence. That's the long view." |
| 1:05–1:50 | Evidence page → **Run profile update**; then the step list | "Now the agent plans. It checked the evidence first, assessed last week's classroom test against the hypothesis, re-checked, and drafted a summary for me to sign. Every step is a tool call, and code blocks anything the evidence doesn't allow." |
| 1:50–2:10 | **See the full run log**: timeline, tokens, cost | "Every model call and tool call, under one run ID, with the cost of this run." |
| 2:10–2:35 | Foot of the Evidence Card, **Sign this summary**: citations on every sentence. Click **Sign as yourself** while signed out → refused. Sign in, edit a line, sign. | "The card is my working view. When the evidence is strong enough, it becomes a short summary for the family. Every sentence points to evidence. The agent can only draft. A *named* teacher signs, and DIRA never sends it. The teacher has that conversation in person." |
| 2:35–2:55 | **Where it fails:** thin-evidence learner → Run profile update → "nothing allowed yet"; and/or the retrieval step marked partial | "Here it refuses: not enough evidence, so no test and no summary. And when a guidance site is down, it carries on and says so." |
| 2:55–3:00 | — | "Synthetic data, open-source, open-weights ready. DIRA recommends; the teacher decides." |

## If something breaks live
Say what broke and show the run log. Honest failure is scored; hidden failure is disqualifying ("results presented as real runs that never happened").
