#!/usr/bin/env node
/**
 * cli.js - Unified CLI Operations Runner
 * =====================================
 * Run any multi-tenant task directly from terminal or cron:
 *   node cli.js views --lead tarun
 *   node cli.js updates
 *   node cli.js expires
 *   node cli.js feed
 *   node cli.js pipeline
 *   node cli.js ping prod_jobiak_ai
 *   node cli.js serve
 */

import { Command } from "commander";
import mongo from "./core/mongo.js";
import { runViewsReport } from "./scripts/views.js";
import { runUpdates } from "./scripts/updates.js";
import { runExpires } from "./scripts/expires.js";
import { runFeedReconciliation } from "./scripts/feed.js";
import { runPipeline } from "./scripts/pipeline.js";

const program = new Command();

program
  .name("jobiak-ops")
  .description("High-Performance Multi-Tenant MongoDB Operations CLI")
  .version("1.0.0");

// 1. Views
program
  .command("views")
  .description("Run Monthly Unique Views report for Google Sheets")
  .option("-l, --lead <lead>", "Target lead name (default: 'tarun')", "tarun")
  .option("-s, --sheet <id>", "Custom spreadsheet ID")
  .action(async (opts) => {
    try {
      await runViewsReport(opts.lead, opts.sheet);
    } finally {
      await mongo.close();
    }
  });

// 2. Updates
program
  .command("updates")
  .description("Run Proxy sliding window updates")
  .action(async () => {
    try {
      await runUpdates();
    } finally {
      await mongo.close();
    }
  });

// 3. Expires
program
  .command("expires")
  .description("Run Zero-Click job expiry evaluation")
  .action(async () => {
    try {
      await runExpires();
    } finally {
      await mongo.close();
    }
  });

// 4. Feed
program
  .command("feed")
  .description("Reconcile XML feed / staging vs production posted jobs")
  .action(async () => {
    try {
      const summary = await runFeedReconciliation();
      console.table(summary);
    } finally {
      await mongo.close();
    }
  });

// 5. Pipeline
program
  .command("pipeline")
  .description("Run daily proxy pipeline (updates -> expires)")
  .action(async () => {
    await runPipeline();
  });

// 6. Ping
program
  .command("ping <dbName>")
  .description("Measure latency to any MongoDB database cluster")
  .action(async (dbName) => {
    try {
      const latency = await mongo.ping(dbName);
      console.log(`[OK] Ping to '${dbName}': ${latency}ms`);
    } catch (e) {
      console.error(`[FAIL] Ping to '${dbName}': ${e.message}`);
    } finally {
      await mongo.close();
    }
  });

// 7. Serve
program
  .command("serve")
  .description("Start the REST API server")
  .action(async () => {
    await import("./api.js");
  });

program.parse(process.argv);
