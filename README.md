# antigravity-nodejs

> High-performance, lightweight, and secure Node.js engine for multi-tenant MongoDB infrastructure (1,200+ databases), Google Sheets sync, pipeline orchestration, and REST API microservices.

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Architecture: Clean ES Modules](https://img.shields.io/badge/Architecture-ESM-yellow.svg)](docs/ARCHITECTURE.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg)](CONTRIBUTING.md)

---

## 📑 Table of Contents
- [Architecture & Layout](#1-architecture--layout)
- [Quick Start](#2-quick-start)
- [Security & Zero Disclosure](#3-security--zero-disclosure)
- [CLI Quick Reference](#4-cli-quick-reference)
- [REST API Microservice](#5-rest-api-microservice)
- [PM2 Process Management](#6-pm2-process-management)
- [Documentation Index](#7-documentation-index)

---

## 1. Architecture & Layout

```text
antigravity-nodejs/
├── .env.example               # Sanitized environment template (safe for Git)
├── clients.example.json       # Sanitized client configuration template
├── package.json               # Manifest & dependency configuration
│
├── core/                      # Centralized Core Subsystem
│   ├── mongo.js               # Universal dynamic MongoDB pool manager (1,200+ DBs)
│   ├── auth.js                # Secure credential loader & environment validator
│   ├── query.js               # Production bot filters & aggregation stages
│   └── googlesheet.js         # Resilient Google Sheets API client with retries
│
├── scripts/                   # Operational Tasks & Pipelines
│   ├── views.js               # Monthly Unique Views calculator & sheets sync
│   ├── updates.js             # Sliding-window active job state synchronizer
│   ├── expires.js             # Zero-click expiry candidate evaluation
│   ├── feed.js                # XML Feed & staging reconciliation
│   └── pipeline.js            # Daily orchestrator (updates -> expires)
│
├── api.js                     # Fast Express REST API microservice
├── cli.js                     # Unified CLI runner (Commander.js)
├── pm2/
│   └── ecosystem.config.cjs   # VPS PM2 process configuration
└── docs/                      # Technical Documentation
    ├── ARCHITECTURE.md        # Concurrency, pooling, and aggregation deep dive
    ├── CLI.md                 # Complete CLI argument and flag reference
    └── API.md                 # REST API endpoints & payload schema
```

---

## 2. Quick Start

### 2.1 Prerequisites
- **Node.js**: v18.0.0 or higher
- **MongoDB**: Access credentials for tenant clusters

### 2.2 Setup

```bash
# 1. Clone repository & install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your specific MongoDB URIs and credentials

# 3. Configure multi-tenant clients
cp clients.example.json clients.json
# Edit clients.json with your tenant IDs and database names
```

### 2.3 Verify Connectivity

```bash
# Ping a central or tenant database cluster
node cli.js ping prod_jobiak_ai
```

---

## 3. Security & Zero Disclosure

To guarantee production security:
- **Zero Hardcoded Secrets**: No hostnames, database connection strings, passwords, or employee emails are baked into source code.
- **Strict `.gitignore`**: All live secrets (`.env`, `credentials.json`, `clients.json`, `logs/`) are permanently ignored by Git.
- **Clean Templates**: Only `.env.example` and `clients.example.json` are tracked in version control.

---

## 4. CLI Quick Reference

Execute operational jobs on-demand:

```bash
# Start the Express REST API
node cli.js serve --port 4000

# Run Monthly Unique Views report
node cli.js views --lead tarun

# Run sliding window updates across all tenant clusters
node cli.js updates --days 7

# Audit zero-click listings approaching expiration
node cli.js expires --threshold 30

# Run complete daily automated pipeline
node cli.js pipeline
```

👉 *See [docs/CLI.md](docs/CLI.md) for full argument, flag, and options documentation.*

---

## 5. REST API Microservice

Start the microservice using `node cli.js serve` (Default Port: `4000`):

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service uptime, status, and cluster ping latency |
| `GET` | `/api/ping/:db` | Measure latency to any specific database cluster |
| `GET` | `/api/clients` | List registered tenant databases and leads |
| `POST` | `/api/run/views` | Trigger Monthly Views calculation & Google Sheet sync |
| `POST` | `/api/run/updates` | Trigger sliding-window updates |
| `POST` | `/api/run/expires` | Trigger zero-click expiry audit |
| `POST` | `/api/run/pipeline`| Trigger end-to-end proxy pipeline |

👉 *See [docs/API.md](docs/API.md) for request/response payloads, headers, and schemas.*

---

## 6. PM2 Process Management

For production servers, manage the API microservice and scheduled daily pipeline using PM2:

```bash
# Start all services defined in ecosystem config
pm2 start pm2/ecosystem.config.cjs

# Inspect logs
pm2 logs

# Check status
pm2 status
```

---

## 7. Documentation Index

- [System Architecture & Specifications](docs/ARCHITECTURE.md)
- [CLI Command & Flag Reference](docs/CLI.md)
- [REST API Specification](docs/API.md)
- [Contribution Guidelines & Git Workflow](CONTRIBUTING.md)
- [Changelog & Version History](CHANGELOG.md)
