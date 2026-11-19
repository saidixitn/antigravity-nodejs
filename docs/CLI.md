# Command Line Interface (CLI) Guide

`antigravity-nodejs` provides a unified, structured CLI powered by [Commander.js](https://github.com/tj/commander.js).

You can execute commands either directly via `node cli.js <command>` or via the global/local binary alias `antigravity-nodejs <command>`.

---

## Command Reference

### 1. `serve`
Starts the Express REST API microservice.

```bash
node cli.js serve [options]
```

**Options:**
- `-p, --port <number>` : Port to bind the HTTP server to (Default: `4000` or `process.env.PORT`).

**Example:**
```bash
node cli.js serve --port 5000
```

---

### 2. `ping`
Tests latency and socket connectivity to a specified MongoDB cluster or database.

```bash
node cli.js ping <db_name>
```

**Arguments:**
- `<db_name>` : Target database name (e.g. `prod_jobiak_ai` or specific tenant database).

**Example:**
```bash
node cli.js ping prod_jobiak_ai
```

---

### 3. `views`
Computes monthly unique views, applies bot-filtering aggregation, and updates the designated Google Sheet report.

```bash
node cli.js views [options]
```

**Options:**
- `-l, --lead <name>` : Filter by operations lead (Default: `tarun`).
- `-m, --month <string>` : Target month string (Default: current month, e.g. `2026-11`).
- `--dry-run` : Runs pipeline aggregation without mutating external Google Sheets.

**Example:**
```bash
# Run monthly views for Tarun's portfolio
node cli.js views --lead tarun

# Execute dry-run to verify counts without mutating production sheets
node cli.js views --lead tarun --dry-run
```

---

### 4. `updates`
Executes sliding-window active job updates across all configured multi-tenant databases.

```bash
node cli.js updates [options]
```

**Options:**
- `-d, --days <number>` : Sliding window size in days (Default: `7`).
- `-c, --client <name>` : Target a specific client key from `clients.json` instead of all tenants.

**Example:**
```bash
node cli.js updates --days 14
node cli.js updates --client whatjobs
```

---

### 5. `expires`
Audits zero-click job listings and flags candidate records for expiration.

```bash
node cli.js expires [options]
```

**Options:**
- `--threshold <days>` : Inactivity threshold in days (Default: `30`).
- `--commit` : Persist expiration updates to the database (without this flag, runs in audit-only mode).

**Example:**
```bash
# Audit zero-click candidates
node cli.js expires --threshold 30

# Commit expiration updates
node cli.js expires --threshold 30 --commit
```

---

### 6. `feed`
Runs reconciliation between external XML job feeds, staging collections, and production databases.

```bash
node cli.js feed [options]
```

**Options:**
- `-f, --force` : Force full re-sync even if feed etag/timestamp has not changed.

**Example:**
```bash
node cli.js feed
```

---

### 7. `pipeline`
Orchestrates the entire daily production maintenance pipeline in a single sequential execution:
1. Executes `updates` (sliding-window sync).
2. Executes `expires` (zero-click pruning).
3. Dispatches notifications / alerts if configured.

```bash
node cli.js pipeline
```
