# Contributing Guidelines

Welcome to `antigravity-nodejs`. To maintain code quality, security, and reproducible deployments across our team, all contributors must follow these guidelines.

---

## 1. Branch Strategy

We follow the standard Git Feature-Branch workflow:
- `main` : Production-ready, stable branch. Direct commits to `main` are restricted.
- `feat/<feature-name>` : For new capabilities, CLI commands, or endpoints.
- `fix/<bug-name>` : For bug fixes, connection pool handling, or pipeline patches.
- `perf/<optimization>` : For database indexing, query optimization, or memory improvements.
- `docs/<doc-update>` : For documentation updates.

---

## 2. Commit Message Standards (Conventional Commits)

Commit messages must strictly follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```text
<type>(<scope>): <short description in present tense>

[optional body explaining context / reason]
```

### Types:
- `feat` : A new feature or script
- `fix` : A bug fix
- `perf` : Code change improving performance
- `refactor` : Code change that neither fixes a bug nor adds a feature
- `docs` : Documentation changes only
- `chore` : Routine tasks (dependency updates, configuration changes)

### Examples:
- `feat(core): add dynamic connection pooling with LRU eviction`
- `fix(query): exclude bot user-agents in monthly views aggregation`
- `docs(api): document rest endpoints and payload schema`

---

## 3. Security Guidelines & Zero Disclosure

- **Never commit `.env`, `credentials.json`, or `clients.json`**.
- Before staging files, always run `git status` to verify untracked files are sanitized.
- If you add a new environment variable, update `.env.example` with a redacted dummy value.
- Do not log raw credentials, tokens, or personal identifiers in `pino` logger output.

---

## 4. Code Standards

- **ES Modules (`import`/`export`)**: All code must use standard ES module syntax (`"type": "module"`).
- **Async/Await**: Avoid callback hell; use `async/await` with proper `try/catch` error boundaries.
- **Resource Cleanup**: Always close database cursors or return connections to the pool.
