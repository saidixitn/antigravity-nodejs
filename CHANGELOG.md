# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-11-19

### Added
- **Core Engine Subsystem**:
  - `core/mongo.js`: Dynamic connection pool manager multiplexing 1,200+ multi-tenant MongoDB databases with signal handlers.
  - `core/auth.js`: Environment validator with strict fallback guards.
  - `core/query.js`: Production bot heuristic filtering pipeline stages.
  - `core/googlesheet.js`: Exponential backoff retry handler for Google Sheets API operations.
- **Single-Purpose Operational Pipelines**:
  - `scripts/views.js`: Monthly unique views calculator with automated sheet reporting.
  - `scripts/updates.js`: Sliding-window job state synchronizer.
  - `scripts/expires.js`: Zero-click candidate identification and TTL expiry audit.
  - `scripts/feed.js`: Real-time XML feed vs. staging vs. production reconciler.
  - `scripts/pipeline.js`: End-to-end proxy pipeline orchestrator.
- **Interfaces**:
  - `cli.js`: Unified CLI built on Commander.js supporting `serve`, `ping`, `views`, `updates`, `expires`, `feed`, and `pipeline`.
  - `api.js`: Express REST API with Pino logging, rate limiting, and status telemetry.
- **Process Management & Docs**:
  - PM2 configuration (`pm2/ecosystem.config.cjs`) for VPS deployments.
  - Full documentation suite (`README.md`, `docs/ARCHITECTURE.md`, `docs/CLI.md`, `docs/API.md`, `CONTRIBUTING.md`).
  - `.env.example` and `clients.example.json` templates for zero-disclosure security.
