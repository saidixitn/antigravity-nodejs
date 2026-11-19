# REST API Specification

The `antigravity-nodejs` microservice exposes a lightweight, performant REST API for triggering operational jobs, performing health checks, and monitoring cluster metrics.

The API is started using `node cli.js serve`.

---

## Base URL
```
http://localhost:4000
```

---

## 1. System & Telemetry Endpoints

### 1.1 Health & Uptime
Returns microservice operational status, system uptime, and connection health to the primary MongoDB cluster.

- **URL:** `/health`
- **Method:** `GET`
- **Response `200 OK`:**
```json
{
  "status": "healthy",
  "uptime": "4h 22m 10s",
  "timestamp": "2026-11-19T12:00:00.000Z",
  "database": {
    "status": "connected",
    "latencyMs": 14
  }
}
```

### 1.2 Cluster Latency Ping
Measures round-trip query latency to any specific tenant or shared database.

- **URL:** `/api/ping/:db`
- **Method:** `GET`
- **Params:** `:db` - Database identifier (e.g. `prod_jobiak_ai`)
- **Response `200 OK`:**
```json
{
  "database": "prod_jobiak_ai",
  "reachable": true,
  "latencyMs": 12,
  "timestamp": "2026-11-19T12:00:00.000Z"
}
```

---

## 2. Tenant Management

### 2.1 List Configured Tenants
Returns metadata for all registered client mappings loaded from `clients.json`.

- **URL:** `/api/clients`
- **Method:** `GET`
- **Response `200 OK`:**
```json
{
  "count": 42,
  "clients": [
    {
      "key": "whatjobs",
      "name": "WhatJobs Global",
      "lead": "tarun",
      "database": "whatjobs_prod"
    }
  ]
}
```

---

## 3. Operational Job Triggers

*All job trigger endpoints execute asynchronously or synchronously and return real-time operational status.*

### 3.1 Run Monthly Unique Views Report
- **URL:** `/api/run/views`
- **Method:** `POST`
- **Query / JSON Body:**
  ```json
  {
    "lead": "tarun",
    "month": "2026-11"
  }
  ```
- **Response `200 OK`:**
```json
{
  "success": true,
  "job": "views",
  "lead": "tarun",
  "rowsUpdated": 18,
  "durationMs": 4210
}
```

### 3.2 Run Sliding Updates
- **URL:** `/api/run/updates`
- **Method:** `POST`
- **Query / JSON Body:**
  ```json
  {
    "days": 7,
    "client": "whatjobs"
  }
  ```
- **Response `200 OK`:**
```json
{
  "success": true,
  "job": "updates",
  "recordsProcessed": 14820,
  "durationMs": 8950
}
```

### 3.3 Run Zero-Click Expiry Audit
- **URL:** `/api/run/expires`
- **Method:** `POST`
- **Query / JSON Body:**
  ```json
  {
    "threshold": 30,
    "commit": false
  }
  ```
- **Response `200 OK`:**
```json
{
  "success": true,
  "job": "expires",
  "candidatesFound": 124,
  "committed": false
}
```

### 3.4 Run Full Daily Pipeline
- **URL:** `/api/run/pipeline`
- **Method:** `POST`
- **Response `200 OK`:**
```json
{
  "success": true,
  "job": "pipeline",
  "stages": ["updates", "expires"],
  "status": "completed",
  "totalDurationMs": 14200
}
```
