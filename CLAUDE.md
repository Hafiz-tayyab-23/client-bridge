# Claude Code working agreement — NASCON Web Dev

Read PLAN.md and docs/01-LIVE-RULES.md first. The organizer's live prompt and rules outrank every prepared document in this folder.

## Goal
Deliver the strongest complete, working, clearly presentable solution within the event's rules and today's development window: 10:00 AM–4:00 PM PKT (6 hours). Feature freeze is 3:00 PM PKT; submission target is 3:55 PM PKT. No code changes after 4:00 PM. Protect the final hour (3:00–4:00 PM) for verification, deployment recovery, submission, and demo rehearsal. Do not promise first place; optimize for judge-visible completeness, usability, reliability, and explanation.

## Start protocol
1. Extract the exact prompt, explicit constraints, deliverables, judging criteria, and deadline into docs/02-PROBLEM-BRIEF.md.
2. Convert every explicit requirement into an observable acceptance check in docs/03-REQUIREMENTS.md. Mark each Must / Should / Could and identify any ambiguity.
3. Propose the smallest coherent architecture and stack that satisfies the live rules. Do not assume Next.js, Supabase, Vercel, or any other technology is mandatory unless the live prompt or rules require it.
4. Draft or update docs/04-DESIGN.md with a specific, professional visual system before building UI. Use the available frontend-design capability if installed.
5. Build a deployed vertical slice early; then expand only against prioritized acceptance checks.

## Implementation rules
- Inspect the existing files and installed package versions before editing. Follow the repository's framework documentation when versions differ from memory.
- Prefer one deployable frontend and the simplest backend/data setup that satisfies the live prompt. Add separate services only when required or when there is a clear judging benefit.
- Never silently replace a required language, framework, database, service boundary, or deployment requirement.
- Build real end-to-end flows. Keep controls honest: a visible action must work, be clearly disabled, or be labeled unavailable.
- Do not invent facts, analytics, users, or successful verification. Label synthetic demo data. Explain assumptions in docs/DECISIONS.md or PLAN.md.
- Keep secrets in local ignored env files and hosting settings. Commit only an empty-value .env.example. Never expose server keys in browser code.
- Use accessible labels, keyboard interaction, responsive layouts, loading/error/empty/success states, and validation near inputs.
- Avoid a generic dashboard look: define a deliberate palette, type scale, layout rhythm, and one memorable product-specific visual detail. Avoid decorative motion/3D that harms clarity or costs time.
- Keep modules small enough to inspect. Do not generate huge unreviewed batches. After each milestone, run relevant checks and report failures honestly.

## Time control (all times PKT, 2026-10-18)
- Window: 10:00 AM start, 4:00 PM hard code cutoff. Keep a visible clock-time and remaining-time note in PLAN.md.
- 2:45 PM: stop starting new features and stabilize.
- 3:00 PM: feature freeze. Use remaining time for tests, deployment recovery, and demo prep.
- 3:55 PM: submission target — repository pushed, live link verified, submission sent.
- 4:00 PM: no code updates or modifications.
- If behind, cut Could items first, then Should items. Never cut the core user journey or a required deliverable without telling the team.

## Collaboration
One person operates Claude and owns code integration. One teammate owns Supabase/cloud setup and checks deployment settings. One teammate independently tests the live URL, checks mobile usability, and prepares the demo. Do not let multiple people edit the same files simultaneously. If only one laptop is available, use these as sequential responsibilities and keep a shared visible checklist.

## Completion report
Before declaring done, report: implemented acceptance IDs, incomplete IDs, exact commands and results, live URL, known issues, demo account/setup method, and the three-minute demo sequence. Do not claim tests or deploys that were not run.
