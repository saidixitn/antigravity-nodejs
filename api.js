/**
 * api.js - High-Performance REST API Microservice
 * ===============================================
 * Provides simple, fast REST API endpoints for dashboards, webhooks,
 * and automated cron triggers across all multi-tenant databases.
 */

import express from "express";
import cors from "cors";
import mongo from "./core/mongo.js";
import { env } from "./core/auth.js";
import logger from "./core/logger.js";
import { runViewsReport } from "./scripts/views.js";
import { runUpdates } from "./scripts/updates.js";
import { runExpires } from "./scripts/expires.js";
import { runPipeline } from "./scripts/pipeline.js";
import { runFeedReconciliation } from "./scripts/feed.js";

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

// 2. Measure ping latency to any database cluster
app.get("/api/ping/:db", async (req, res) => {
  const { db } = req.params;
  try {
    const latency = await mongo.ping(db);
    res.json({ database: db, latencyMs: latency, status: "connected" });
  } catch (err) {
    res.status(500).json({ database: db, status: "error", error: err.message });
  }
});

// 3. List multi-tenant databases from creds registry
app.get("/api/clients", async (req, res) => {
  try {
    const clients = await mongo.listClients();
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

// 5. Trigger Monthly Views report
app.post("/api/run/views", async (req, res) => {
  const lead = req.query.lead || req.body.lead || "tarun";
  res.json({ message: `Triggered Views Report for lead '${lead}' in background.` });

  runViewsReport(lead).catch((err) => {
    logger.error("Background Views Report failed", err);
  });
});

// 6. Trigger Proxy Sliding Updates
app.post("/api/run/updates", async (req, res) => {
  res.json({ message: "Triggered Proxy Sliding Updates in background." });

  runUpdates().catch((err) => {
    logger.error("Background Updates failed", err);
  });
});

// 7. Trigger Zero-Click Expires
app.post("/api/run/expires", async (req, res) => {
  res.json({ message: "Triggered Zero-Click Expires in background." });

  runExpires().catch((err) => {
    logger.error("Background Expires failed", err);
  });
});

// 8. Trigger Full Daily Pipeline
app.post("/api/run/pipeline", async (req, res) => {
  res.json({ message: "Triggered Daily Proxy Pipeline in background." });

  runPipeline().catch((err) => {
    logger.error("Background Pipeline failed", err);
  });
});

const PORT = env.port || 4000;
app.listen(PORT, () => {
  logger.success(`REST API Server listening on port ${PORT}`);
});

export default app;
