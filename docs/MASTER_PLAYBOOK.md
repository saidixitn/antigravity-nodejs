# Antigravity Node.js — Master Operational Playbook

> Complete operational manual, Google for Jobs schema compliance guide, GPD workflow specifications, client registry, and command center reference for Jobiak's multi-tenant infrastructure.

---

## 📑 Table of Contents
1. [Google for Jobs (GFJ) Schema & Description Rules](#1-google-for-jobs-gfj-schema--description-rules)
2. [GPD (Google Programmatic Distribution) Architecture](#2-gpd-google-programmatic-distribution-architecture)
3. [Client Directory & Dual Employer IDs](#3-client-directory--dual-employer-ids)
4. [GXC Feed Intelligence (generateXml_prod)](#4-gxc-feed-intelligence-generatexml_prod)
5. [Revenue & Partner Syndication Subsystems](#5-revenue--partner-syndication-subsystems)
6. [Daily, Weekly & Monthly Operational Runbooks](#6-daily-weekly--monthly-operational-runbooks)
7. [CLI & REST API Cheat-Sheet](#7-cli--rest-api-cheat-sheet)

---

## 1. Google for Jobs (GFJ) Schema & Description Rules

Google for Jobs parses structured data (`schema.org/JobPosting`) and the plain HTML `<description>` to index job listings into Google Search cards.

### 1.1 The 5 Critical Production Description Defects
When scraping client ATS platforms (UKG/UltiPro, Workday, Taleo, iCIMS, ADP), uncleaned artifacts leak into `description`, triggering severe penalties:

| Defect | Search / Business Impact | Example Artifact | Cleaning Engine Logic |
| :--- | :--- | :--- | :--- |
| **1. Leading Scrape Timestamps** | **Ruins Search Snippet**: Google uses the first 160 characters of the description for the card snippet. A timestamp like *"Posted Aug 26..."* makes the job look months old and destroys CTR. | `Posted Wednesday, August 26, 2026, 4:00 AM <p>...` | `RX_POSTED_PREFIX = /^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2}.../i` |
| **2. Rogue Period / Stray Dot** | **HTML Rendering Bug**: Generates an empty bold bullet or dot above the job title. | `<p><strong>.</strong></p><p>Seeking a grounds keeper...` | `RX_STRAY_DOT = /^\s*<p><strong>\s*\.\s*<\/strong><\/p>\s*/i` |
| **3. Trailing Un-Tagged Street Addresses** | **CSS Margin Collapse**: Naked text hanging after the final `</p>` tag renders outside layout containers. | `...<p>Hiring Max: $20</p>8401 E Saddlebrook Dr, Charleston SC` | Prunes non-HTML plain text appended after `lastIndexOf('>')`. |
| **4. Outbound Career Links / Apply Leaks** | **Traffic & Conversion Ruined**: Disclaimers instructing candidates to *"apply directly on client.com/careers"* cause candidates to bypass Jobiak proxy tracking (`/gfj/`), destroying tracked applications. | `Visit yescommunities.com/careers directly for confirmed positions...` | `RX_APPLY_LEAKS` scrubs all direct apply bypass text and raw URLs. |
| **5. Appended Raw Pay Tags** | **Missing Schema Feature**: Raw strings like `<p>Pay: Hourly</p>` fail Google's structured salary badge. | `<p><strong>Hiring Min Rate:</strong> 18 USD</p>` | Extracted into structured `baseSalary` JSON-LD (`QuantitativeValue`). |

### 1.2 Schema.org/JobPosting Specification
- **`title`**: Must be clean and concise (< 100 chars). Never stuff locations or clickbait (`"HIRING NOW!!!"`).
- **`description`**: Full sanitized HTML body.
- **`datePosted`**: ISO 8601 string (`YYYY-MM-DDTHH:mm:ssZ`).
- **`hiringOrganization`**: Object with `@type: "Organization"`, `name`, and `sameAs` (client domain).
- **`jobLocation`**: Required for physical jobs (`PostalAddress` with `addressLocality`, `addressRegion`, `postalCode`, `addressCountry`).
- **`applicantLocationRequirements`**: Required for remote/telecommute roles.
- **`baseSalary`**: Valid `MonetaryAmount` specifying `currency`, `minValue`, `maxValue`, and `unitText: "HOUR" | "MONTH" | "YEAR"`.

---

## 2. GPD (Google Programmatic Distribution) Architecture

The GPD pipeline automates the lifecycle of hundreds of thousands of listings:

```mermaid
flowchart TD
    ATS["Client ATS / XML Feed (Workday, UKG, Taleo, iCIMS)"] -->|Raw Ingestion| Staging["JobiCare Staging (jobicarenode_prod)<br>Target_P4_Opt<br>emp-jicn-*"]
    
    subgraph GPDQualityGate["GPD Quality Gate (gpd.js + gfjSchema.js)"]
        Scrub["1. Description Hygiene (Strip timestamps, stray dots, leaks)"]
        Schema["2. Schema.org Validation (baseSalary, PostalAddress)"]
        TitleNorm["3. Keyword Lowercase Title Normalization"]
    end

    Staging --> GPDQualityGate
    GPDQualityGate -->|Promote to Production| Prod["Production Cluster (prod_jobiak_ai)<br>job collection<br>24-char hex employerId"]

    Prod -->|Post via Indexing API| Google["Google for Jobs Search Cards"]
    Prod -->|Proxy Pages| Tracking["Jobiak Proxy Pages (/gfj/ Tracking)"]
    Tracking -->|Raw Events| Analytics["userAnalytics (Clicks & Impressions)"]
    Analytics -->|Daily Bot-Filter Stage| Reports["Monthly Unique Views & Sheets"]

    Prod -->|Sliding Updates (7d)| Updates["updates.js (Refreshes Active Jobs)"]
    Analytics -->|Zero Clicks (30d)| Expiry["expires.js (Prunes Dead Listings)"]
```

---

## 3. Client Directory & Dual Employer IDs

Every client bridges two databases. Use this directory to map between them:

| Client Name | Domain | Production `employerId` (`prod_jobiak_ai.job`) | JobiCare ID (`jobicarenode_prod.Target_P4_Opt`) | Type |
| :--- | :--- | :--- | :--- | :--- |
| **HCSG** | `hcsgcorp.com` | `6a904f26060e8f0b78b0dc81` | `emp-jicn-hcsg` | Proxy |
| **Concentrix** | `concentrix.com` | `6a8871d1060e8f0b78b0dc69` | `emp-jicn-concentrix` | Proxy |
| **ABS Kids** | `abskids.com` | `6aa8d214060e8f0b78b0dc87` | `emp-jicn-abs` | Proxy |
| **QRM** | `qrm-inc.com` | `6a7b516d060e8f0b78b0dc5a` | `emp-jicn-qrm` | Proxy |
| **YES! Communities** | `yescommunities.com` | `6a86c3d7060e8f0b78b0dc66` | `emp-jicn-yescommunities` | Proxy |

*Dynamic Discovery: If a client is not present in `clients.json`, the engine queries the `Domains!A2:E` sheet in Google Sheets dynamically.*

---

## 4. GXC Feed Intelligence (`generateXml_prod`)

- **Database:** `generateXml_prod`
- **Catalog:** Over 396+ `emp-gxc-*` collections storing XML syndication listings for major national accounts (*DoorDash, Uber, Albertsons, Gopuff, Grubhub*).
- **Cross-Feed Analysis:** `node cli.js gxc compare --company doordash` multiplexes across all 396+ collections, normalizes company variants (*"Uber"*, *"UberEats"*, *"Uber Eats"* $\rightarrow$ `Uber Eats`), and extracts `title`, `count`, `avgCpa`, and `avgCpc`.

---

## 5. Revenue & Partner Syndication Subsystems

1. **WhatJobs (`scripts/revenue.js`)**:
   - Reconciles partner listings against `whatjobs_revenue` and WhatJobs spreadsheet.
   - Extracts numeric `jobId` from tracking links via `_(\d{5,})__` or `(\d{6,})`.
   - Command: `node cli.js revenue whatjobs`.
2. **JobGet (`scripts/revenue.js`)**:
   - Reconciles active inventory counts for syndicated JobGet campaigns against `JOBGET_GOOGLE_SHEET_ID`.
   - Command: `node cli.js revenue jobget`.
3. **Banana (`scripts/revenue.js`)**:
   - High-speed syndication pipeline with dynamic fallback between local and remote mongos (`LOCAL_DOMAIN_MONGOS`).
   - Command: `node cli.js revenue banana`.

---

## 6. Daily, Weekly & Monthly Operational Runbooks

### Runbook A: Daily Production Maintenance (09:00 AM IST)
```bash
# Runs sliding updates (7 days) followed by zero-click expiry sweeps
node cli.js pipeline
```

### Runbook B: GPD Staging Quality Audit
```bash
# 1. Audit description quality & schema compliance
node cli.js gpd audit --client "YES! Communities"

# 2. Clean scrape artifacts in staging (Dry Run)
node cli.js gpd clean --client "YES! Communities"

# 3. Clean and commit to database
node cli.js gpd clean --client "YES! Communities" --commit
```

### Runbook C: Weekly Feed Reconciliation
```bash
# Check staging vs production posted counts across all clients
node cli.js feed
```

### Runbook D: Monthly Unique Views Billing Report
```bash
# Run monthly views report for Tarun's portfolio
node cli.js views --lead tarun
```

---

## 7. CLI & REST API Cheat-Sheet

### Unified CLI Commands
```bash
# GPD Quality & Cleaning
node cli.js gpd audit [--client <name>]
node cli.js gpd clean [--client <name>] [--commit]
node cli.js schema:validate "<title>" "<description>"

# Operational Pipelines
node cli.js pipeline              # Daily updates -> expires
node cli.js feed                  # XML feed reconciliation
node cli.js views --lead tarun    # Monthly views to Google Sheets
node cli.js updates               # Sliding updates
node cli.js expires               # Zero-click expiry audit

# Revenue & Syndication
node cli.js revenue whatjobs      # WhatJobs sync
node cli.js revenue jobget        # JobGet sync
node cli.js revenue banana        # Banana sync
node cli.js revenue all           # All partners

# Telemetry & Stats
node cli.js stats daily           # Active vs Inactive counts across all clients
node cli.js stats clicks --days 7 # Click event trend report
node cli.js stats topost          # Pending staging jobs

# GXC Feed Intelligence
node cli.js gxc list              # List all 396+ emp-gxc-* collections
node cli.js gxc compare --company doordash

# Client Diagnostics
node cli.js client qrm            # QRM location & unclosed tag audit
node cli.js client hcsg           # HCSG posting integrity audit
```

### REST API Endpoints (Port 4000)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Cluster health, uptime, and latency |
| `POST` | `/api/run/gpd/audit` | Trigger GPD quality audit |
| `POST` | `/api/run/gpd/clean` | Trigger GPD description cleaning |
| `POST` | `/api/schema/validate` | Test schema compliance for title/description |
| `POST` | `/api/run/gxc/compare` | Run cross-feed CPA/CPC analysis |
| `GET` | `/api/gxc/collections` | List all 396+ GXC collections |
| `POST` | `/api/run/stats/daily` | Query cluster-wide inventory stats |
| `POST` | `/api/run/stats/clicks` | Extract click interaction trends |
| `POST` | `/api/run/revenue/:source` | Trigger revenue sync (`whatjobs`, `jobget`, `banana`) |
| `POST` | `/api/run/pipeline` | Trigger end-to-end proxy pipeline |
