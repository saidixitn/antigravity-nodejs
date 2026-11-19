/**
 * api.js - High-Performance REST API Microservice & Command Center
 * ===============================================================
 * Provides simple, fast REST API endpoints for dashboards, webhooks,
 * Google for Jobs schema validation, GPD audits, and automated triggers.
 */

import express from "express";
import cors from "cors";
import mongo from "./core/mongo.js";
import { env, loadClientsConfig } from "./core/auth.js";
import logger from "./core/logger.js";
import { runViewsReport } from "./scripts/views.js";
import { runUpdates } from "./scripts/updates.js";
import { runExpires } from "./scripts/expires.js";
import { runPipeline } from "./scripts/pipeline.js";
import { runFeedReconciliation } from "./scripts/feed.js";
import { runWhatJobsSync, runJobGetSync, runBananaSync, runAllRevenue } from "./scripts/revenue.js";
import { runDailyStats, runClicksReport, runToPostCheck } from "./scripts/stats.js";
import { listGxcCollections, runGxcCompare } from "./scripts/gxc.js";
import { runGpdAudit, runGpdClean } from "./scripts/gpd.js";
import { runCollisionCheck } from "./scripts/collision.js";
import { runDuplicateAudit } from "./scripts/dedup.js";
import { expandLocationKeywords } from "./scripts/keywords.js";
import { runIndexingAudit } from "./scripts/indexingAudit.js";
import { cleanJobDescription, validateJobPostingSchema } from "./core/gfjSchema.js";

const app = express();
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl}`, `${res.statusCode} in ${duration}ms`);
  });
  next();
});

// 1. Health check & latency monitor
app.get("/health", async (req, res) => {
  try {
    const start = Date.now();
    await mongo.getRoot();
    const hubLatency = Date.now() - start;

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      hubLatencyMs: hubLatency,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  } catch (err) {
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

// 2. Measure database latency
app.get("/api/ping/:db", async (req, res) => {
  const { db } = req.params;
  try {
    const latency = await mongo.ping(db);
    res.json({ database: db, latencyMs: latency, reachable: true });
  } catch (err) {
    res.status(500).json({ database: db, reachable: false, error: err.message });
  }
});

// 3. List multi-tenant clients
app.get("/api/clients", (req, res) => {
  try {
    const clients = loadClientsConfig();
    res.json({ count: clients.length, clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Feed reconciliation summary
app.get("/api/feed/summary", async (req, res) => {
  try {
    const summary = await runFeedReconciliation();
    res.json({ success: true, count: summary.length, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Pre-Posting Ingestion Collision Gate
app.post("/api/run/collision", async (req, res) => {
  try {
    const report = await runCollisionCheck(req.body.client, { limit: req.body.limit });
    res.json({ success: true, count: report.length, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5b. Duplicate Job Clustering & Cannibalization Prevention
app.post("/api/run/dedup", async (req, res) => {
  try {
    const report = await runDuplicateAudit(req.body.client || "Concentrix", { limit: req.body.limit });
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5c. Googlebot Crawl vs View Bottleneck Analyzer
app.post("/api/run/audit/indexing", async (req, res) => {
  try {
    const report = await runIndexingAudit(req.body.client || "HCSG", { limit: req.body.limit });
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5d. Location Keywords Expansion
app.post("/api/run/keywords/expand", async (req, res) => {
  try {
    const report = await expandLocationKeywords(req.body.client || "HCSG", { limit: req.body.limit });
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. GPD Quality Audit & Cleaning
app.post("/api/run/gpd/audit", async (req, res) => {
  try {
    const report = await runGpdAudit({ client: req.body.client, limit: req.body.limit });
    res.json({ success: true, count: report.length, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/run/gpd/clean", async (req, res) => {
  try {
    const result = await runGpdClean({ client: req.body.client, commit: req.body.commit === true });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Schema Cleaning & Validation Helper
app.post("/api/schema/validate", (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: "title and description are required" });
  }
  const cleaned = cleanJobDescription(description);
  const validation = validateJobPostingSchema({ title, description: cleaned, datePosted: new Date() });
  res.json({ cleaned, validation });
});

// 7. GXC Feed Operations
app.get("/api/gxc/collections", async (req, res) => {
  try {
    const cols = await listGxcCollections();
    res.json({ count: cols.length, collections: cols });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/run/gxc/compare", async (req, res) => {
  try {
    const results = await runGxcCompare({ company: req.body.company });
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Stats & Clicks Operations
app.post("/api/run/stats/daily", async (req, res) => {
  try {
    const results = await runDailyStats();
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/run/stats/clicks", async (req, res) => {
  try {
    const results = await runClicksReport({ days: req.body.days || 7 });
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Revenue Operations
app.post("/api/run/revenue/:source", async (req, res) => {
  const { source } = req.params;
  try {
    let result;
    if (source === "whatjobs") result = await runWhatJobsSync(req.body);
    else if (source === "jobget") result = await runJobGetSync(req.body);
    else if (source === "banana") result = await runBananaSync(req.body);
    else if (source === "all") result = await runAllRevenue(req.body);
    else return res.status(400).json({ error: "Invalid source: use whatjobs, jobget, banana, all" });

    res.json({ success: true, source, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Operational Pipelines
app.post("/api/run/views", async (req, res) => {
  const lead = req.query.lead || req.body.lead || "tarun";
  res.json({ message: `Triggered Views Report for lead '${lead}' in background.` });
  runViewsReport(lead).catch((err) => logger.error("Background Views failed", err));
});

app.post("/api/run/updates", async (req, res) => {
  res.json({ message: "Triggered Proxy Sliding Updates in background." });
  runUpdates().catch((err) => logger.error("Background Updates failed", err));
});

app.post("/api/run/expires", async (req, res) => {
  res.json({ message: "Triggered Zero-Click Expires in background." });
  runExpires().catch((err) => logger.error("Background Expires failed", err));
});

app.post("/api/run/pipeline", async (req, res) => {
  res.json({ message: "Triggered Daily Proxy Pipeline in background." });
  runPipeline().catch((err) => logger.error("Background Pipeline failed", err));
});

const PORT = env.port || 4000;
app.listen(PORT, () => {
  logger.success(`REST API Server listening on port ${PORT}`);
});

export default app;
