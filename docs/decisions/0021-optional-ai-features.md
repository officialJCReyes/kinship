# 0021. AI features are optional and off by default

- Status: **Accepted** (decision by JC, 2026-11-18)
- Date: 2026-11-18
- Builds on: [0001 Stack](0001-stack.md), which says KinShip has no AI features
- Code: none. This changes wording and a standing rule only.

## Context

`CLAUDE.md`, `CONTRIBUTING.md` and ADR 0001 said "no AI features". On 2026-11-16 JC approved one optional exception, Automatic transcription of handwritten scans (design: `design/kinship-transcription-engines-and-matching.md`, release 0.5). On 2026-11-18 he asked that the repository say AI features are optional, rather than absent.

## Decision

- AI features may exist, **only as optional features that are off by default**.
- A feature stays off until an admin connects an engine or opts in. With none connected, no AI control appears in the interface and nothing leaves the server.
- **Nothing in the app may call an AI service before the feature is built and the maintainer has asked for it.** This part of the earlier rule is unchanged.
- The interface names the feature, for example "Automatic transcription", and does not use "AI" as a feature name.
- Reports, summaries, duplicate detection and person matching stay fixed rules and templates. Notes saying "no AI, fixed templates" on those features remain true and are not changed.
- Person matching never sends names from the tree to an engine.

## Consequences

- Reworded in this change: `CLAUDE.md` (Hard rules), `CONTRIBUTING.md` (Rules for the public repository), ADR 0001 (one sentence).
- Not changed here, because `design/` is a read-only mirror of the Project docs: `design/kinship-v2-requirements.md` ("No AI features." in the constraints list) and `design/kinship-release-and-deployment-plan.md` (the goals list). The build-status doc already records the amendment. Reword them in the Project and sync.
- Public website copy says AI features are optional and off until an admin connects one.
