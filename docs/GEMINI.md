# Jobiak Search Engineering & Multi-Tenant Node.js Master Knowledge Base (GEMINI.md)

> Authoritative, LLM-grade technical specification and operational manual for Jobiak search infrastructure, Google for Jobs schema rules, multi-tenant MongoDB routing, production indexes, and dedicated Node.js automation scripts.

---

## 📑 Table of Contents

1. [Architecture & Multi-Tenant Routing](#1-architecture--multi-tenant-routing)
2. [Dual-Mode MongoDB Engine (`core/mongo.js`)](#2-dual-mode-mongodb-engine)
3. [The 3 Platform Architectures](#3-the-3-platform-architectures)
4. [Production Collections & MongoDB Indexes Atlas](#4-production-collections--mongodb-indexes-atlas)
5. [Google Views, Clicks & Bot Filtering Logic](#5-google-views-clicks--bot-filtering-logic)
6. [Daily Stats Engine (`scripts/dailystats.js`)](#6-daily-stats-engine)
7. [Dedicated Partner Revenue Engines](#7-dedicated-partner-revenue-engines)
8. [Ingestion Collision Pre-Posting Gate (`scripts/collision.js`)](#8-ingestion-collision-pre-posting-gate)
9. [Same-City Duplicate Clustering (`scripts/dedup.js`)](#9-same-city-duplicate-clustering)
10. [Location Keywords Generator (`scripts/keywords.js`)](#10-location-keywords-generator)
11. [Indexing & Crawl Audit Engine (`scripts/indexingAudit.js`)](#11-indexing--crawl-audit-engine)
12. [The 5 Critical Description HTML Cleaners (`core/gfjSchema.js`)](#12-the-5-critical-description-html-cleaners)
13. [Multi-Alias Analytics Join Resolver (`core/aliasMap.js`)](#13-multi-alias-analytics-join-resolver)
14. [REST API Microservice (`api.js` & `api.http`)](#14-rest-api-microservice)
15. [Master Engineering Dictionary (A–Z)](#15-master-engineering-dictionary-a-z)
16. [Operational Playbook & Standard Run Commands](#16-operational-playbook--standard-run-commands)

---

## 1. Architecture & Multi-Tenant Routing

### Why Multi-Tenant Dynamic Routing Exists
Jobiak operates across more than **1,200 MongoDB databases** distributed across multiple dedicated production clusters. Hardcoding connection strings or host IP addresses in individual scripts creates brittle code, leaks credentials, and fails whenever passwords rotate or shard allocations shift.

Instead, the infrastructure uses a **Hub-and-Spoke Discovery Architecture**:
1. **The Central Hub Cluster (`<CENTRAL_VPS_HUB_IP>:27017`)** stores dynamic routing records inside `mongo_creds.creds` and service account keys in `google_creds.creds`.
2. **Dynamic Discovery**: When a script requires a handle to `{client}_prod`, it looks up `{"domain": "{client}_prod"}` in `mongo_creds.creds`, retrieves the target connection URI, URL-encodes special characters, and connects through a cached connection pool.
3. **Localhost First Rule**: Small, temporary, analytical aggregation, and revenue sync operations run on local MongoDB (`127.0.0.1:27017`), placing zero unneeded load on production clusters.

### Server Cluster Topology (Sanitized)

| Cluster Role | Key Databases Hosted | Architecture Served |
|---|---|---|
| **Central Hub** | `mongo_creds`, `google_creds`, `daily_stats`, `daily_domain_stats`, `Clicks_Report`, `domain_expires`, `banana_analytics`, `whatjobs_revenue`, `jobget_revenue` | Operational Orchestration |
| **Proxy Production Cluster** | `prod_jobiak_ai` *(all Proxy clients: HCSG, ABS Kids, Concentrix, QRM, YES! Communities, Earn Haus, Champion Window, Imperial Supplies)* | Reverse-Proxy Subdirectories (`/gfj/`, `/jobiak/`) |
| **Direct Apply Cluster** | `directclients_prod` *(all Direct Apply clients: `gfj.lettuce.com`, `gfj.apexfocusgroup.com`, `gfj.levelsurveys.com`)* | Managed Subdomains |
| **XML Feed Cluster** | `generateXml_prod` *(396+ partner feed collections `emp-gxc-*`)*, `PJP_Schedular` | Ingestion & Partner Feeds |
| **Staging & Scraping Cluster** | `jobicarenode_prod` *(Proxy staging source)*, `ETL_Scrapping_Data`, `data_cleansing` | Pre-posting Ingestion & Cleansing |
| **Programmatic Multi-Tenant Shards** | 1,150+ individual `{slug}_prod` databases *(e.g. `hextill_prod`, `vertexisle_prod`)* | High-volume Wholly Owned Aggregators |

---

## 2. Dual-Mode MongoDB Engine (`core/mongo.js`)

`core/mongo.js` provides automatic connection pooling, error resilience, and transparent routing between local and remote clusters:

```javascript
import mongo from "./core/mongo.js";

// 1. Localhost Database (127.0.0.1:27017)
const localDb = await mongo.localDb("daily_stats");
const localOutput = localDb.collection("output");

// 2. Dynamic Remote Cluster (Discovered via mongo_creds.creds)
const prodDb = await mongo.db("prod_jobiak_ai");
const liveJobsCount = await prodDb.collection("job").countDocuments({ status: "posted", isActive: true });

// 3. Graceful Pool Cleanup
await mongo.close();
```

---

## 3. The 3 Platform Architectures

Understanding which database, collection, ID field, and employer filter applies to a domain is essential for search engineering accuracy:

| Dimension | 1. Proxy | 2. Direct Apply | 3. Programmatic |
|---|---|---|---|
| **URL Pattern** | Reverse proxy subdirectory (`domain.com/gfj/`) | Managed subdomain (`gfj.lettuce.com`) | Standalone aggregator (`hextill.com`) |
| **Database** | `prod_jobiak_ai` (Shared) | `directclients_prod` (Shared) | `{slug}_prod` (Dedicated per domain) |
| **Jobs Collection** | `job` | `Target_P4_Opt` | `Target_P4_Opt` |
| **Analytics Collection** | `userAnalytics` | `userAnalytics` (+ `userAnalytics_prod` in lifetime) | `userAnalytics` |
| **Google API Logs** | `jobsGoogleSubmittedLog` | `aj_jp_google_logs` | `aj_jp_google_logs` |
| **Employer Filter** | **MANDATORY**: `{ employerId: { $in: ids } }` | **MANDATORY**: `{ employerId: { $in: ids } }` | **OMIT** (`{}`) for whole-domain stats |
| **Primary Job ID** | `jobId` & `clientJobId` | `jobPubJobId` & `uniqueKey` | `jobPubJobId` & `uniqueKey` |
| **Title Field** | `title` | `jobtitle` | `jobtitle` |
| **Active Live Filter** | `{ status: "posted", isActive: true }` | `{ gpost: 5, job_status: { $ne: 3 } }` | `{ gpost: 5, job_status: { $ne: 3 } }` |
| **Feed Expired Filter** | `data_cleansing.ETL_AUD_Data` (`Type: 0`) or `jobicarenode_prod` (`job_status: 3`) | `{ job_status: 3 }` | `{ job_status: 3 }` |
| **Pending Filter (`To_Post`)** | `clientJobId` set difference: Staging minus Live | `{ gpost: 1, job_status: { $ne: 3 } }` | `{ gpost: 1, job_status: { $ne: 3 } }` |
| **Expiration Date Field** | `validThrough` | `pub_expired` | `pub_expired` |

---

## 4. Production Collections & MongoDB Indexes Atlas

### A. `prod_jobiak_ai.job` (Proxy Master Jobs)
- **Sample Document**:
  ```json
  {
    "_id": "646790ed9d602a379ef7933c",
    "jobId": "646790ec9d602a379ef7933a",
    "clientJobId": "9399_1126_5176-7b24dd1b38662e5dfed79af8ea5b68bd",
    "employerId": "6a904f26060e8f0b78b0dc81",
    "domain": "https://hcsgcorp.com",
    "submittedUrl": "https://hcsgcorp.com/gfj/dietary-aide-charleston-sc-646790ec9d602a379ef7933a",
    "title": "Dietary Aide",
    "company": "Healthcare Services Group",
    "location": "Charleston,SC,US",
    "datePosted": "2026-11-11T10:34:58.397Z",
    "validThrough": "2026-12-09T10:34:58.397Z",
    "employmentType": "FULL_TIME",
    "status": "posted",
    "isActive": true
  }
  ```
- **Crucial Compound Indexes**:
  - `employerId_1_isActive_1_status_1`
  - `isActive_1_status_1_employerId_1_jobId_1`
  - `employerId_1_clientJobId_1`

### B. `Target_P4_Opt` (`directclients_prod` & Programmatic `{slug}_prod`)
- **Sample Document**:
  ```json
  {
    "_id": "644147112fe99409181dbf0c",
    "employerId": "emp-jbk-lettuce",
    "company": "Lettuce Entertain You Restaurants",
    "jobtitle": "Line Cook",
    "uniqueKey": "cook`line~~chicago~~il~~us~~lettuce`entertain`you",
    "jobPubJobId": "644147422fe99409181dbf11",
    "uncleanedLocation": "Chicago,IL,US",
    "gpost": 5,
    "job_status": 2,
    "action": "post",
    "gpost_date": "2026-11-10T08:00:00.000Z",
    "pub_expired": "2026-12-10T08:00:00.000Z"
  }
  ```
- **Crucial Compound Indexes**:
  - `pub_expired_1_gpost_1` *(Mandatory hint on large collections to prevent 600s timeouts!)*
  - `employerId_1_job_status_1_gpost_1_gpost_date_1_action_1`
  - `job_status_1_gpost_1_employerId_1`

### C. `userAnalytics` (Google Traffic & Bot Logs)
- **Crucial Compound Indexes**:
  - Proxy (`prod_jobiak_ai`): `childJobId_1_jobId_1_ipAddress_1_browser_1_createdDt_1`, `employerId_1`
  - Direct Apply (`directclients_prod`): `isBot_1_createdDt_1_deviceType_1_browserType_1_countryCode_1_isFromGoogle_1`, `viewType_1_employerId_1_viewDate_1`

---

## 5. Google Views, Clicks & Bot Filtering Logic

### Pure Human Google Click Filter
To eliminate bot crawls, headless scripters, and internal team traffic, every valid human Google click must satisfy all 5 criteria:

```javascript
const PURE_HUMAN_GOOGLE_FILTER = {
  isBot: false,
  isFromGoogle: true,
  browserType: { $ne: "Unknown" },
  deviceType: { $ne: "Unknown" },
  createdDt: { $gte: windowStart, $lt: windowEnd }
};
```

### Unique Views (`DB_Clicks`) Deduplication
- **Raw Views**: Total click records matching the filter.
- **Unique Views (`DB_Clicks`)**: Deduplicated by `(ipAddress, job)` so one person refreshing or bookmarking a job counts as **1**:
  - Proxy: Grouped by `{ ip: "$ipAddress", job: "$jobId" }`
  - Direct Apply / Programmatic: Grouped by `{ ip: "$ipAddress", job: "$jobPubJobId" }`

---

## 6. Daily Stats Engine (`scripts/dailystats.js`)

### Purpose & Architecture
Replaces Python `Stats/dailystats.py`. Reads the monitored domain roster from local `daily_stats.input`, queries target production databases across Proxy, Direct Apply, and Programmatic architectures, and writes **two distinct documents per domain** into local `daily_stats.output`:

1. **TODAY Document (`Date = TODAY 00:00 UTC`)**:
   - Contains **ONLY live volatile metrics**: `To_Post`, `FeedExpiredJobs`, `LiveGeneratedAt`.
   - Overwritten on every run throughout the day as job queues fluctuate.
2. **YESTERDAY Document (`Date = YESTERDAY 00:00 UTC`)**:
   - Contains all **closed 24-hour metrics**: `Active_Jobs`, `Posted_Jobs`, `Updated_Jobs`, `Reposts`, `Cache_Updated_Jobs`, `Expired_Jobs`, `Posted_Bot`, `Expires_Bot`, `DB_Clicks`, `Bot_Visits`, `Posting_Queue`, `Expires_Queue`, `Post_Fail`, `Expires_Fail`, `To_Expire_In_5Days`, `Total_Posted_Jobs`, `Total_Expired_Jobs`, `HistoricalGeneratedAt`, `WindowStart`, `WindowEnd`.
   - Does **NOT** overwrite `To_Post` or `FeedExpiredJobs` on yesterday's record, preserving yesterday's closing snapshot.

### Execution
```bash
# Standalone execution
node scripts/dailystats.js

# Via REST API
curl -X POST http://localhost:4000/api/dailystats
```

---

## 7. Dedicated Partner Revenue Engines

### 7.1 WhatJobs (`scripts/whatjobs.js`)
- **Extraction Rule**: Outbound click tracking URLs are parsed using regex:
  ```javascript
  const RX_WHATJOBS = /___[0-9]+_([0-9]{5,})__/;
  ```
- **Storage**: Upserts extracted job ID, click timestamp, and publisher metadata into local collection `whatjobs_revenue.wj_views`.
- **Run**: `node scripts/whatjobs.js`

### 7.2 JobGet (`scripts/jobget.js`)
- **Publishers Supported**: Publisher `664` (CPA) and Publisher `739` (CPC).
- **Sanitization**: Parses stringified revenue representations (`"$1.25"`) into validated floating-point numbers.
- **Storage**: Writes normalized partner payouts to local `jobget_revenue`.
- **Run**: `node scripts/jobget.js`

### 7.3 Banana (`scripts/banana.js`)
- **Syndication Snapshots**: Groups hourly human clicks by `(ipAddress, jobPubJobId)` and records hourly traffic metrics.
- **Storage**: Writes hourly document snapshots to local `banana_analytics.hourly_stats`.
- **Run**: `node scripts/banana.js`

---

## 8. Ingestion Collision Pre-Posting Gate (`scripts/collision.js`)

### The Business Problem
When preparing to publish jobs from Jobicare staging (`jobicarenode_prod.Target_P4_Opt`) to Proxy Production (`prod_jobiak_ai.job`), candidate listings must be checked against existing production records. If a unique key already exists in production, posting it again creates duplicate URLs, corrupts Google for Jobs indexing, or resurrects removed listings without fresh ATS data.

### The Canonical Mapping
$$\text{jobicarenode\_prod.Target\_P4\_Opt.uniqueKey} \longleftrightarrow \text{prod\_jobiak\_ai.job.clientJobId}$$

### Execution
```bash
node scripts/collision.js
```
The script partitions candidates into:
- **Collision (Cannot Post)**: Broken down by status (`posted`, `removed`, `processing`).
- **Available to Post**: Completely new inventory eligible for publishing.

---

## 9. Same-City Duplicate Clustering (`scripts/dedup.js`)

### The Cannibalization Problem
When multiple postings exist for the same job title in the same city (e.g. Concentrix or HCSG), Google for Jobs divides impressions across duplicate URLs, diluting rankings.

### Clustering Algorithm
1. Buckets active jobs strictly by **normalized city and state**.
2. Applies **Union-Find graph clustering** using title similarity ($\ge 0.78$) and Jaccard token overlap ($\ge 0.60$).
3. **Decision Logic**:
   - Compares unique human Google views: Highest views $\rightarrow$ `ACTIVE` (Keep).
   - Lower views $\rightarrow$ `EXPIRE` (Flag for removal).
   - Zero views on all candidates $\rightarrow$ `REVIEW`.

```bash
node scripts/dedup.js
```

---

## 10. Location Keywords Generator (`scripts/keywords.js`)

### Strict Lowercase Rule
> [!IMPORTANT]
> All `title` values in keyword collections and generated CSV exports **MUST be lowercase** (`cook`, `dietary aide`, `housekeeper`, `laundry worker`, `registered dietitian`).

### Standard 10-Column Schema
Outputs the standard Jobiak location keywords schema:
`_id, employerId, confidenceValue, keyword, keywordType, operatorType, title, isActive, companyName, createdAt`

```bash
node scripts/keywords.js
```

---

## 11. Indexing & Crawl Audit Engine (`scripts/indexingAudit.js`)

Triages all active listings into three actionable performance buckets:
1. **Generating Views**: Ranking well on Google for Jobs and capturing applicant clicks.
2. **Crawled by Googlebot (Zero Views)**: Google crawled the listing, but it did not rank or convert. Action: Optimize title, schema, or description.
3. **Never Crawled**: Googlebot has never visited the URL. Action: Submit via Google Indexing API or check XML sitemap inclusion.

```bash
node scripts/indexingAudit.js
```

---

## 12. The 5 Critical Description HTML Cleaners (`core/gfjSchema.js`)

When scraping ATS systems (UKG, Workday, Taleo, iCIMS), raw headers, unclosed HTML elements, and scrapers' artifacts leak into `description` HTML:

| Issue | Penalty on Google for Jobs | Drop-in Fix in `core/gfjSchema.js` |
|---|---|---|
| **1. Leading Scrape Timestamps** | Google displays `"Posted Aug 26, 2026"` in search snippet, making new jobs appear stale. | Strips `^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2}...` |
| **2. Rogue Stray Dot** | ATS artifacts like `<p><strong>.</strong></p>` display as unsightly dots at the top of descriptions. | Strips `^\s*<p><strong>\s*\.\s*<\/strong><\/p>\s*` |
| **3. Trailing Street Addresses** | Physical addresses floating un-tagged after the final `</p>` tag cause layout rendering bugs. | Truncates text hanging past the final `>` character. |
| **4. Outbound Career Links (Apply Leaks)** | Warnings telling candidates to visit root career sites divert applicants away from proxy tracking. | Strips direct apply warning phrases and direct URLs. |
| **5. Appended Pay Rate Tags** | Raw `<p><strong>Pay Type:</strong> Hourly</p>` cluttering description body. | Cleans and normalizes into structured schema salary fields. |

---

## 13. Multi-Alias Analytics Join Resolver (`core/aliasMap.js`)

In `prod_jobiak_ai.userAnalytics`, click and view events can reference jobs through legacy fields: `childJobId`, `jobId`, `jobPubJobId`, or `clientJobId`. Joining strictly on `jobId` causes up to a **35% loss in valid Google views**.

`core/aliasMap.js` builds an in-memory resolution dictionary from `prod_jobiak_ai.job`:
```javascript
import { buildAliasMap, resolveCanonicalJobId } from "./core/aliasMap.js";

const aliasMap = await buildAliasMap("prod_jobiak_ai", "6a904f26060e8f0b78b0dc81");
const canonicalId = resolveCanonicalJobId(analyticsDoc.childJobId || analyticsDoc.jobId, aliasMap);
```

---

## 14. REST API Microservice (`api.js` & `api.http`)

### Starting the Server
```bash
node api.js
```
Listens on `http://localhost:4000`.

### Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server uptime and cluster ping latency |
| `GET` | `/api/uri/:domain` | Dynamic URI resolution from `mongo_creds.creds` (masked) |
| `GET` | `/api/clients` | List registered tenant configurations |
| `POST` | `/api/dailystats` | Execute Daily Stats engine (`daily_stats.input` -> `output`) |
| `POST` | `/api/whatjobs` | Run WhatJobs revenue sync |
| `POST` | `/api/jobget` | Run JobGet publisher sync |
| `POST` | `/api/banana` | Run Banana syndication snapshot |
| `POST` | `/api/collision` | Pre-posting ingestion collision check |
| `POST` | `/api/clean` | Sanitize description HTML (strip timestamps and leaks) |

### 1-Click Interactive Testing with `api.http`
Open [`api.http`](file:///c:/Users/JOBIAK/Documents/Antigravity-Python-Nodejs/api.http) in VS Code with the REST Client extension to test endpoints with a single click.

---

## 15. Master Engineering Dictionary (A–Z)

- **`action`**: Field in `Target_P4_Opt` (`"post"`, `"update"`, `"repost"`) indicating the publishing lifecycle state.
- **`Cache_Updated_Jobs`**: Jobs marked updated without consuming a Google `URL_UPDATED` Indexing API call (content hash unchanged).
- **`childJobId`**: Join key in `userAnalytics` referencing `job.jobId` in Proxy architecture.
- **`clientJobId`**: Requisition ID linking `jobicarenode_prod.Target_P4_Opt.uniqueKey` $\longleftrightarrow$ `prod_jobiak_ai.job.clientJobId`.
- **`DB_Clicks`**: Pure human organic clicks originating from Google for Jobs, deduplicated by `(ipAddress, job)`.
- **`feedData`**: Integer flag in `Target_P4_Opt.extraInfo` (`1` = original client ATS feed listing; `0` = GEO/title expanded listing).
- **`FeedExpiredJobs`**: Jobs removed from the client ATS feed (`job_status == 3` in Direct/Prog; `Type == 0` in `ETL_AUD_Data` for Proxy).
- **`gpost`**: Google indexing status code:
  - `1` = To Post (Pending initial queue)
  - `3` = In Posting Queue
  - `4` = Post Failed
  - `5` = Posted Live (Google for Jobs)
  - `6` = Expired
  - `8` = In Expiry Queue
- **`job_status`**: Feed freshness code (`3` = removed from feed; `!= 3` = active in feed).
- **`LIVE_FIELDS`**: The set `{"To_Post", "FeedExpiredJobs"}` written exclusively to `TODAY`'s document in `daily_stats.output`.
- **`pub_expired`**: Expiration cutoff timestamp on `Target_P4_Opt`.
- **`validThrough`**: ISO timestamp on `prod_jobiak_ai.job` establishing Google schema expiration.

---

## 16. Operational Playbook & Standard Run Commands

| What You Need To Do | Command to Execute |
|---|---|
| **Run Daily Operational Stats** | `node scripts/dailystats.js` |
| **Run WhatJobs Revenue Sync** | `node scripts/whatjobs.js` |
| **Run JobGet CPA/CPC Sync** | `node scripts/jobget.js` |
| **Run Banana Hourly Snapshot** | `node scripts/banana.js` |
| **Audit Pre-Posting Collision** | `node scripts/collision.js` |
| **Cluster Same-City Duplicates** | `node scripts/dedup.js` |
| **Generate Lowercase Location Keywords** | `node scripts/keywords.js` |
| **Audit Indexing & Crawl Buckets** | `node scripts/indexingAudit.js` |
| **Start REST API Microservice** | `node api.js` |
| **Run Production PM2 Daemons** | `pm2 start pm2/ecosystem.config.cjs` |
