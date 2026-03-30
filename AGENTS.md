# AGENTS Principles

This file defines operating principles for contributors and autonomous agents working on Agentrade. It must be updated as working practices evolve.

## Engineering Principles

- Keep variable configuration centralized in `packages/config` so updates stay easy to manage.
- Follow The Bitter Lesson and first-principles reasoning.
- Prefer simple, elegant, direct implementations over premature complexity.
- Build modular, composable components that are easy to modify, adjust, and extend.
- In persistence mode, keep API write paths on direct repository transactions over normalized tables; avoid snapshot rebuild/rewrite on hot paths.
- Keep settlement and dispute transitions guarded by explicit transactional invariants and row-lock ordering.
- Preserve deterministic behavior in state transitions and settlements.
- Every externally visible rule must be documented and testable.
- Keep interfaces explicit through shared types (`packages/types`) and OpenAPI contracts.

## Quality Principles

- Combine modular tests with integration, end-to-end lifecycle, and full-system tests.
- Validate functional completeness at system level, not only module level.
- Prevent repeated regressions by adding tests for each discovered failure mode.
- Prioritize deterministic concurrency safety tests for publish/accept/vote/dispute flows.
- When DB suites share one database, run reset-heavy suites serially; do not execute them in parallel against the same DB instance.
- If deadlocks appear during concurrent test runs, rerun serially to separate environment interference from real business-logic regressions.

## Planning and Decision Principles

- Perform comprehensive research before choosing technical direction, architecture, or implementation approach.
- When material uncertainty remains, discuss tradeoffs with users before making a final decision.
- Record chosen routes and rationale in `docs/tech_plan.md` and `docs/progress/status.md`.

## Delivery and Deployment Principles

- Use Docker in build and development workflows to provide portable, reproducible deployment environments.
- Keep local scripts, Docker workflows, and CI validations aligned.
- Ensure persistence and restart behavior is reproducible from repository data.

## Product Boundary Principles

- Web is read-only for human users.
- Agent writes are performed through CLI/API with authenticated identities.
- Admin actions are restricted to admin channels and audited.
- Every cycle settlement must be reproducible from ledger and workload records.
- The system UI must support Chinese/English language switching.
- Default UI language should follow the local user language.
- If local language is neither Chinese nor English, use English as fallback.

## Documentation Principles

- Maintain `docs/` as a living directory and continuously sync technical route, planning, and progress updates.
- Keep `README.md` updated with project status, highlights, environment setup, usage guide, and repository structure for open-source onboarding.
- Keep API contracts explicit and synchronized in `docs/api/overview.md` and `docs/api/openapi.yaml`.
- English text is the primary source for all project texts, including `docs`, `README`, `AGENTS`, and prompts.
- Every English text change must include a same-commit Chinese mirror file (`*_cn.md`).
- `README`, `docs`, and `AGENTS` must stay synchronized in both languages.
- Keep `AGENTS.md` complete with commonly used principles and update it whenever conventions change.
