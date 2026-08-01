---
name: bootstrap-project
description: One-time project bootstrap for gastro-saas - inspects the environment, creates initial documentation, Claude configuration, repo structure, ticket templates, and the first stack evaluation. Explicitly invoked only, never runs automatically.
---

Manual-invocation only — do not trigger this automatically from a routine coding request.

## Steps

1. Inspect environment: git, `gh` CLI + auth status, package manager, Node version, container tooling, existing files, available MCP servers. Never print credentials.
2. Create/refresh core docs under `docs/` if missing: product vision, MVP scope, non-goals, system context, domain boundaries, ADRs, domain model, threat model, tenant isolation, service register, test strategy, deployment strategy, assumptions log.
3. Create/refresh `CLAUDE.md`, `.claude/rules/`, `.claude/agents/sonnet-implementer.md`, `.claude/agents/opus-validator.md`, the other skills, and safe hooks.
4. Research required external services via `/research-service` (free-for.dev first, verify officially) and write `docs/platform/service-register.md`.
5. Produce a concise architecture proposal and have it validated by `opus-validator` before any implementation ticket starts.
6. Report what was created, what's still a blocker (accounts, domain, production approval), and the next command to run.

Do not implement product features in this skill — foundation only.
