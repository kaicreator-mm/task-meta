---
name: task-meta-agent-cli-validation
description: CLI-first task-meta capture-plugin verification for Claude Code, Codex and ZCode; use for install/upgrade, real Hook/Spool/Outbox, GitHub E2E, session correlation and failures. Source of truth is the project's .agents/skills canonical Skill.
---

# Task-meta Agent CLI validation

Read and follow the **single canonical Skill** at:

`../../../.agents/skills/task-meta-agent-cli-validation/SKILL.md`

This Claude entrypoint exists only for automatic project-level discovery; **do not independently maintain a second CLI recipe here**. If the canonical file is not available in the checked-out project root, report `SKILL_SOURCE_NOT_AVAILABLE` rather than guessing commands.

For Claude Code, also read `../../../plugins/claude/task-meta-capture/README.md`, confirm actual `claude --version` and `claude plugin --help`, and preserve exact-SHA/Host/real-session evidence. Hook fixture PASS is not a real Claude Code CLI capture PASS.