/**
 * api.js - High-Performance Local REST API & Operations Hub
 * ==========================================================
 * Provides fast, clean REST endpoints for local development and automations:
 * 
 * System Endpoints:
 *   GET  /health              -> Local & remote cluster latency
 *   GET  /api/uri/:domain     -> Dynamic MongoDB URI lookup from mongo_creds.creds
 *   GET  /api/clients         -> List registered tenant clients
 * 
 * Dedicated Operations:
 *   POST /api/dailystats      -> Daily stats engine (reads daily_stats.input -> daily_stats.output)
 *   POST /api/whatjobs        -> WhatJobs URL-matching & revenue sync
 *   POST /api/jobget          -> JobGet Publisher 664/739 CPA/CPC sync
 *   POST /api/banana          -> Banana syndication snapshot
 *   POST /api/views           -> Monthly Google views report for Google Sheets
 *   POST /api/updates         -> Sliding-window active job updates
 *   POST /api/expires         -> 30-day zero-click expiry audit
 *   POST /api/feed            -> Staging vs production feed reconciliation
 *   POST /api/collision       -> Pre-posting ingestion collision check
 *   POST /api/clean           -> Clean dirty description HTML (strip timestamps/leaks)
 */

import express from "express";
import cors from "cors";
import mongo from "./core/mongo.js";
import { env, loadClientsConfig } from "./core/auth.js";
import logger from "./core/logger.js";

// Core Operational Scripts
import { runDailyStats } from "./scripts/dailystats.js";
import { runWhatJobs } from "./scripts/whatjobs.js";
import { runJobGet } from "./scripts/jobget.js";
import { runBanana } from "./scripts/banana.js";
import { runViewsReport } from "./scripts/views.js";
import { runUpdates } from "./scripts/updates.js";
import { runExpires } from "./scripts/expires.js";
import { runFeedReconciliation } from "./scripts/feed.js";
import { runCollisionCheck } from "./scripts/collision.js";
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

// =============================================================================
// SYSTEM ENDPOINTS
// =============================================================================

// 1. Health check & cluster latency
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

// 2. Dynamic MongoDB URI Resolver from mongo_creds.creds (NO hardcoded IPs!)
app.get("/api/uri/:domain", async (req, res) => {
  const { domain } = req.params;
  try {
    const uri = await mongo.getUri(domain);
    if (!uri) {
      return res.status(404).json({ error: `No URI found for domain '${domain}' in mongo_creds.creds` });
    }
    // Mask password for safe display
    const masked = uri.replace(/\/\/[^:]+:([^@]+)@/, "//***:***@");
    res.json({ domain, uri: masked, resolved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// =============================================================================
// DEDICATED PARTNER & STATS ENDPOINTS
// =============================================================================

// 4. Daily Stats Engine (Reads daily_stats.input -> daily_stats.output)
app.post("/api/dailystats", async (req, res) => {
  try {
    const report = await runDailyStats();
    res.json({ success: true, count: report.length, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. WhatJobs URL-Matching & Revenue Sync
app.post("/api/whatjobs", async (req, res) => {
  try {
    const report = await runWhatJobs();
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. JobGet Publisher CPA & CPC Sync
app.post("/api/jobget", async (req, res) => {
  try {
    const report = await runJobGet();
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Banana Aggregator Syndication Sync
app.post("/api/banana", async (req, res) => {
  try {
    const report = await runBanana();
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// CORE OPERATIONAL PIPELINES
// =============================================================================

// 8. Monthly Google Views Report for Google Sheets
app.post("/api/views", async (req, res) => {
  const lead = req.query.lead || req.body.lead || "tarun";
  res.json({ message: `Triggered Views Report for lead '${lead}' in background.` });
  runViewsReport(lead).catch((err) => logger.error("Background Views failed", err));
});

// 9. Proxy Sliding Updates
app.post("/api/updates", async (req, res) => {
  res.json({ message: "Triggered Proxy Sliding Updates in background." });
  runUpdates().catch((err) => logger.error("Background Updates failed", err));
});

// 10. Zero-Click Expiry Audit
app.post("/api/expires", async (req, res) => {
  res.json({ message: "Triggered Zero-Click Expires in background." });
  runExpires().catch((err) => logger.error("Background Expires failed", err));
});

// 11. Feed Reconciliation
app.post("/api/feed", async (req, res) => {
  try {
    const summary = await runFeedReconciliation();
    res.json({ success: true, count: summary.length, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Pre-Posting Ingestion Collision Gate
app.post("/api/collision", async (req, res) => {
  try {
    const report = await runCollisionCheck(req.body.client, { limit: req.body.limit });
    res.json({ success: true, count: report.length, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Description HTML Sanitizer & Schema Validator
app.post("/api/clean", (req, res) => {
  const { title, description } = req.body;
  if (!description) {
    return res.status(400).json({ error: "description is required" });
  }
  const cleaned = cleanJobDescription(description);
  const validation = validateJobPostingSchema({
    title: title || "Job Title",
    description: cleaned,
    datePosted: new Date(),
  });
  res.json({ cleaned, validation });
});

const PORT = env.port || 4000;
app.listen(PORT, () => {
  logger.success(`REST API Server listening on http://localhost:${PORT}`);
});

export default app;
