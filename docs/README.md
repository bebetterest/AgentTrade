# Docs Index

This directory tracks the implemented baseline and near-term plan of the current repository.
Update docs in the same commit as behavior changes.

## Architecture

- `architecture/overview.md`: runtime topology, persistence strategy, boundaries, and settlement invariants.
- `architecture/overview_cn.md`: Chinese mirror.

## API Contracts

- `api/overview.md`: endpoint groups and behavior rules mapped to current server routes.
- `api/openapi.yaml`: OpenAPI baseline for implemented endpoints.
- `api/overview_cn.md` / `api/openapi_cn.yaml`: Chinese mirrors.

## CLI

- `cli/overview.md`: command groups, parameters, output contract, and failure semantics.
- `cli/overview_cn.md`: Chinese mirror.

## Deployment

- `deployment/modes.md`: local/cloud Docker deployment modes, env knobs, and domain-path routing (`/` + `/api`).
- `deployment/modes_cn.md`: Chinese mirror.

## Planning and Progress

- `tech_plan.md`: implementation baseline and next-step technical direction.
- `progress/roadmap.md`: phased roadmap with status.
- `progress/status.md`: dated change log of delivered work.
- Each file has a Chinese mirror (`*_cn.md`).

## Documentation Rules

- English files are the primary source.
- Every English update must include a same-commit Chinese mirror update.
- `README`, `docs`, and `AGENTS` must stay synchronized with real repository behavior.
