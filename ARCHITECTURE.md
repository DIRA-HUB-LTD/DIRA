# DIRA: Architecture (one page)

DIRA follows one learner across years. Teachers log what they notice (a phone call after class, or chat); an agent keeps the learner's profile current, proposes small classroom tests to check a hunch, and, once the evidence is strong enough, drafts a cited note a teacher can use with the family. **The agent recommends; a named teacher decides.** Details: [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md); roadmap: [`DIRA_HUB_ROADMAP.md`](./DIRA_HUB_ROADMAP.md).

```
Teacher (call / chat / UI) ──► Next.js App Router ──► services + PostgreSQL (system of record)
                                     │
            profile-update agent (GLM plans tool use, code guards every action)
                                     │  MCP (in-process, official SDK)
                    DIRA MCP server: 15 tools ──► Suggest Test graph (LangGraph.js)
                                     │                 └─► Fetch MCP gateway (borrowed) ──► AMI, WWC
                    GLM-5.3 Flash (Z.AI) or self-hosted open-weights model via lib/models.ts
```

## Stack
| Layer | Choice |
|---|---|
| App | Next.js 16 App Router, React 19, TypeScript, Zod |
| Orchestration | Open source: LangGraph.js (Suggest Test graph) and a bounded tool-calling loop (profile-update agent) |
| Model | GLM-5.3 Flash (Z.AI) by default; any OpenAI-compatible **self-hosted open-weights** server via `DIRA_MODEL_BASE_URL` |
| Data | PostgreSQL; tracked migrations (`npm run db:migrate`) |
| Voice | Africa's Talking (calls), OpenAI transcription (documented temporary exception) |

## The agent (genuinely agentic, bounded by code)
`lib/agent/profile-update-agent.ts`. Triggered on demand or after a confirmed observation or recorded test outcome. GLM decides which tools to call and when to stop:
1. `check_evidence_readiness` (deterministic): what the evidence across all years allows.
2. Act: `assess_test_outcome`, `suggest_test` or `draft_pathway_note`.
3. Re-check after every action; recover from tool errors or blocks; summarise for the teacher.

Guards in code, not prompts: no action before a fresh readiness check; actions blocked unless readiness allows them (blocks logged and explained to the model); `learner_id`/`submission_id` injected and hidden from the model; limits of 6 turns, 10 calls and per-tool caps. **No tool can accept, approve, share or send anything.**

## MCP
- **Own server** (`/api/mcp/server`, 15 tools, ≥3 that take action): observations, evidence card, readiness, Suggest Test (+ persist/regenerate), hypothesis assessment, pathway-note drafts, call drafts, follow-up queue. Per-teacher hashed, revocable tokens pin each caller to one teacher and school, so a school's own system can reuse the tools.
- **Borrowed server: Fetch MCP** (`mcp-server-fetch`, the maintained reference fetch server) behind our authenticated gateway (`fetch-mcp-server/`, Railway) with a domain allowlist and size/time limits. Chosen so we did not write a scraper. IB and EEF block automated requests, so live sources default to AMI and WWC.
- **Planned:** Keeper.sh calendar MCP for individual teachers (client foundation only).

## Safety and governance
- **Evidence before conclusions:** every suggestion, assessment and note cites stored evidence IDs; unknown IDs fail validation. One correction attempt, then fail closed (nothing saved).
- **No labels:** a language guard rejects labels, diagnoses and pathway verdicts in model output and teacher edits.
- **Human gate:** pathway notes are created as DRAFTs. Approval requires a teacher signed in by name (`getSignedInTeacher`, never the demo fallback) who currently teaches the learner; approver, time and exact text are recorded. Nothing is sent to a guardian by DIRA.
- **The long view:** a teacher who currently teaches a learner sees that learner's full history at the same school (every year and class). History at a previous school stays there unless a guardian approves an export.
- **Logged runs:** every model call, tool proposal, block and result is written to `agent_activity_logs` under one run ID with tokens and cost; `/agent-logs?run_id=…` shows the timeline and model cost per run. No chain-of-thought is stored.

## Data
PostgreSQL holds schools, teachers, classes, learners and enrolments across years, timetable, the school calendar, observations (originals never overwritten; reviews versioned), activity tests with lineage, versioned hypothesis assessments, pathway notes, focus assignments, call jobs/recordings and agent logs. Synthetic data only.

## Verification
`npm run test:unit` (unit and in-memory PostgreSQL tests with the real migrations), `npm run test:gateway`, `npm run build`, CI on every push, and `npm run eval` (live model, repeated runs). See [`EVALS.md`](./EVALS.md) for results and the unfixed failure.
