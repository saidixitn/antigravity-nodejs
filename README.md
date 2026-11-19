# antigravity-nodejs

> Clean, modular, and high-performance Node.js backend engine for Jobiak multi-tenant search engineering, Google for Jobs schema rules, partner revenue reconciliation, and operational automation.

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MongoDB Architecture](https://img.shields.io/badge/MongoDB-Dual--Mode%20(Local%20%2B%20Remote)-green.svg)](core/mongo.js)
[![REST API](https://img.shields.io/badge/API-Express%20(Port%204000)-orange.svg)](api.js)

---

## 📑 Table of Contents
1. [Core Design Principles](#1-core-design-principles)
2. [Project Layout](#2-project-layout)
3. [Dual-Mode MongoDB Engine (`core/mongo.js`)](#3-dual-mode-mongodb-engine)
4. [Dedicated Operational Scripts](#4-dedicated-operational-scripts)
5. [REST API Microservice (`api.js` & `api.http`)](#5-rest-api-microservice)
6. [The 3 Platform Architectures](#6-the-3-platform-architectures)
7. [Google for Jobs Rules & Heuristics](#7-google-for-jobs-rules--heuristics)
8. [PM2 Production Orchestration](#8-pm2-production-orchestration)

---

## 1. Core Design Principles

- **No Over-Complicated CLI Bloat**: Run backend tasks directly with plain Node scripts (`node scripts/<task>.js`) or 1-click REST endpoints via [api.http](file:///c:/Users/JOBIAK/Documents/Antigravity-Python-Nodejs/api.http).
- **Localhost by Default**: All small, temporary, aggregation, and revenue sync tasks default to local MongoDB (`127.0.0.1:27017`), placing zero unneeded load on production clusters.
- **Dynamic URI Discovery (Zero Hardcoded Secrets)**: Remote clusters are resolved dynamically via `mongo_creds.creds` or `.env`. No credentials or IPs are baked into source code.
- **Strict Partner Separation**: **WhatJobs**, **JobGet**, and **Banana** are completely separate workflows with their own databases, schemas, and matching logic.
- **Database Safety & Index Hints**: High-volume queries are optimized with compound index prefixes and cursor streaming to eliminate full collection scans.

---

## 2. Project Layout

```text
antigravity-nodejs/
├── .env.example               # Sanitized environment template (safe for Git)
├── package.json               # ESM module manifest & scripts
├── api.js                     # High-performance Express REST API (Port 4000)
├── api.http                   # 1-click interactive REST Client test notebook
│
├── core/                      # Core Subsystems & Helpers
│   ├── mongo.js               # Dual-Mode Mongo manager (Local + Dynamic Remote URI discovery)
│   ├── auth.js                # Environment validator & credentials loader
│   ├── gfjSchema.js           # Google for Jobs schema validator & 5 description HTML cleaners
│   ├── aliasMap.js            # Multi-alias resolver (jobId/childJobId/clientJobId)
│   ├── query.js               # Production bot filters & aggregation pipeline stages
│   ├── logger.js              # Timestamped color logger
│   └── googlesheet.js         # Google Sheets API client with exponential backoff
│
├── scripts/                   # Dedicated Operational Scripts (Run directly with Node)
│   ├── dailystats.js          # Reads daily_stats.input -> writes TODAY & YESTERDAY to daily_stats.output
│   ├── whatjobs.js            # Dedicated WhatJobs URL matching & revenue sync (local whatjobs_revenue)
│   ├── jobget.js              # Dedicated JobGet Publisher 664 & 739 CPA/CPC revenue parser (local jobget_revenue)
│   ├── banana.js              # Dedicated Banana hourly syndication aggregator (local banana_analytics)
│   ├── collision.js           # Pre-posting ingestion collision check (jobicarenode_prod <-> prod_jobiak_ai)
│   ├── dedup.js               # Same-city duplicate clustering & cannibalization audit (Union-Find)
│   ├── keywords.js            # 10-column location keywords generator (strict lowercase titles)
│   ├── indexingAudit.js       # Triages listings: Generating Views vs Crawled Zero Clicks vs Never Crawled
│   ├── views.js               # Monthly Google views report with alias mapping & bot filter
│   ├── updates.js             # Sliding-window active job state synchronizer
│   ├── expires.js             # 30-day zero-click expiry audit
│   ├── feed.js                # XML Feed & staging reconciliation (Feed vs Expanded)
│   └── pipeline.js            # Orchestrated daily sequence (updates -> expires)
│
├── pm2/
│   └── ecosystem.config.cjs   # PM2 configuration for VPS daemons
└── docs/                      # In-depth architectural & operational specs
    ├── GEMINI.md              # Master LLM-grade search engineering manual & knowledge base
    ├── ENTERPRISE_SYSTEM_MANUAL.md
    ├── MASTER_PLAYBOOK.md
    └── ARCHITECTURE.md
```

> 📖 **Full Engineering Knowledge Base**: Read [docs/GEMINI.md](docs/GEMINI.md) for the complete LLM-grade reference on multi-tenant MongoDB routing, exact production schemas, bot filters, indexing hints, and partner reconciliation.

---

## 3. Dual-Mode MongoDB Engine (`core/mongo.js`)

`core/mongo.js` handles both local operations and dynamic discovery across 1,200+ remote databases:

```javascript
import mongo from "./core/mongo.js";

// 1. Localhost Database (127.0.0.1:27017 - Zero network latency, zero remote load)
const localDb = await mongo.localDb("daily_stats");
const localOutput = localDb.collection("output");

// 2. Dynamic Remote Cluster Discovery (via mongo_creds.creds)
const prodDb = await mongo.getDb("prod_jobiak_ai");
const jobCount = await prodDb.collection("job").countDocuments({ status: "posted" });

// 3. Resolve Dynamic Masked URI
const uri = await mongo.getUri("generateXml_prod");

// 4. Clean shutdown
await mongo.closeAll();
```

---

## 4. Dedicated Operational Scripts

Every operational task is an independent script that can be executed directly from terminal:

### 4.1 Daily Stats Engine
Reads `daily_stats.input` from local MongoDB, queries each domain (Proxy, Direct Apply, or Programmatic), and upserts two documents per domain into `daily_stats.output`:
- **TODAY Document**: Live volatile metrics (`To_Post`, `FeedExpiredJobs`, `LiveGeneratedAt`).
- **YESTERDAY Document**: Closed 24-hour snapshot (`Active_Jobs`, `DomainType`, etc.).
```bash
node scripts/dailystats.js
```

### 4.2 Partner Revenue Engines (Strictly Separated)
- **WhatJobs**: Extracts WhatJobs click traffic matching `___[0-9]+_([0-9]{5,})__` into local `whatjobs_revenue.wj_views`.
  ```bash
  node scripts/whatjobs.js
  ```
- **JobGet**: Parses Publisher 664 (CPA) and 739 (CPC) data, sanitizes currency strings into floats, and writes to local `jobget_revenue`.
  ```bash
  node scripts/jobget.js
  ```
- **Banana**: Aggregates hourly human clicks by `(ipAddress, jobPubJobId)` into local `banana_analytics.hourly_stats`.
  ```bash
  node scripts/banana.js
  ```

### 4.3 Ingestion & Pre-Posting Collision Check
Prevents duplicate URLs and cannibalization by verifying candidate unique keys from Jobicare staging before posting to Proxy production:
$$\text{jobicarenode\_prod.Target\_P4\_Opt.uniqueKey} \longleftrightarrow \text{prod\_jobiak\_ai.job.clientJobId}$$
```bash
node scripts/collision.js
```

### 4.4 Same-City Duplicate Clustering
Identifies candidate duplicate postings in the same city using Union-Find clustering and recommends `ACTIVE` (highest unique views) vs `EXPIRE` (lower views).
```bash
node scripts/dedup.js
```

### 4.5 Location Keywords Generator
Generates standard 10-column keywords adhering strictly to the **lowercase title rule** (`cook`, `dietary aide`, `housekeeper`):
```bash
node scripts/keywords.js
```

### 4.6 Indexing & Crawl Audit
Triages active listings into three actionable buckets:
1. **Generating Views**: Ranking well on Google for Jobs.
2. **Crawled by Googlebot (Zero Views)**: Needs title or schema optimization.
3. **Never Crawled**: Needs submission via Google Indexing API or XML sitemap inclusion.
```bash
node scripts/indexingAudit.js
```

---

## 5. REST API Microservice (`api.js` & `api.http`)

The microservice runs on port **4000** and provides fast JSON endpoints:

```bash
node api.js
```

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Cluster ping latency & uptime |
| `GET` | `/api/uri/:domain` | Dynamic MongoDB URI lookup from `mongo_creds.creds` |
| `GET` | `/api/clients` | List registered tenant configurations |
| `POST` | `/api/dailystats` | Run Daily Stats engine (`daily_stats.input` -> `output`) |
| `POST` | `/api/whatjobs` | Run WhatJobs revenue sync |
| `POST` | `/api/jobget` | Run JobGet publisher sync |
| `POST` | `/api/banana` | Run Banana syndication snapshot |
| `POST` | `/api/views` | Trigger Monthly Google Views report |
| `POST` | `/api/updates` | Trigger sliding-window active job updates |
| `POST` | `/api/expires` | Trigger 30-day zero-click expiry audit |
| `POST` | `/api/feed` | Run staging vs production feed reconciliation |
| `POST` | `/api/collision` | Pre-posting ingestion collision check |
| `POST` | `/api/clean` | Clean HTML description (strip timestamps & leaks) |

### 1-Click Interactive Testing with `api.http`
Open [api.http](file:///c:/Users/JOBIAK/Documents/Antigravity-Python-Nodejs/api.http) in VS Code with the REST Client extension to execute any endpoint with a single click.

---

## 6. The 3 Platform Architectures

| Dimension | 1. Proxy | 2. Direct Apply | 3. Programmatic |
|---|---|---|---|
| **URL Pattern** | Reverse proxy subdirectory (`/gfj/`, `/jobiak/`) | Managed subdomain (`gfj.lettuce.com`) | Standalone aggregator domain (`hextill.com`) |
| **Database** | `prod_jobiak_ai` | `directclients_prod` | `{slug}_prod` |
| **Jobs Collection** | `job` | `Target_P4_Opt` | `Target_P4_Opt` |
| **Analytics Collection** | `userAnalytics` | `userAnalytics` | `userAnalytics` |
| **Employer Filter** | **Required** (`employerId: <24-hex>`) | **Required** (`employerId: "emp-jbk-*"`) | **Omit** (`{}`) for whole domain |
| **Job ID Field** | `jobId` & `clientJobId` | `jobPubJobId` & `uniqueKey` | `jobPubJobId` & `uniqueKey` |
| **Active Filter** | `{ status: "posted", isActive: true }` | `{ gpost: 5, job_status: { $ne: 3 } }` | `{ gpost: 5, job_status: { $ne: 3 } }` |
| **Expiry Timestamp** | `validThrough` | `pub_expired` | `pub_expired` |

---

## 7. Google for Jobs Rules & Heuristics

### 7.1 Pure Human Google Click Filter
To filter out bots, crawlers, and internal traffic, every valid Google click must satisfy:
```javascript
{
  employerId: "<employerId>",
  isBot: false,
  isFromGoogle: true,
  browserType: { $ne: "Unknown" },
  deviceType: { $ne: "Unknown" },
  createdDt: { $gte: startDate, $lt: endDate }
}
```

### 7.2 The 5 Description HTML Cleaners
Located in [core/gfjSchema.js](file:///c:/Users/JOBIAK/Documents/Antigravity-Python-Nodejs/core/gfjSchema.js):
1. **Leading Scrape Timestamps**: Strips `Posted Wednesday, September 2, 2026, 4:00 AM` so Google doesn't display stale dates in search snippets.
2. **Rogue Stray Dot**: Strips `<p><strong>.</strong></p>` prepended by ATS scrapers.
3. **Trailing Street Addresses**: Removes un-tagged physical addresses hanging outside the final `</p>` tag.
4. **Outbound Direct Apply Leaks**: Strips URLs advising applicants to visit the career site directly, preserving proxy attribution.
5. **Pay Rate Tags**: Replaces raw salary tags with clean formatted text.

---

## 8. PM2 Production Orchestration

For production deployments, manage processes using PM2:

```bash
# Start API microservice and scheduled daemons
pm2 start pm2/ecosystem.config.cjs

# Monitor logs
pm2 logs

# View real-time dashboard
pm2 monit
```

---

## 📄 License
MIT © Jobiak Engineering
