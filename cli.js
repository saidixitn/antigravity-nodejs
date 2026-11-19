#!/usr/bin/env node
/**
 * cli.js - Unified CLI Operations Runner & Command Center
 * ========================================================
 * Run any multi-tenant task directly from terminal or cron:
 *   node cli.js views --lead tarun
 *   node cli.js collision [clientName]
 *   node cli.js gpd audit [--client <name>]
 *   node cli.js gpd clean [--client <name>] [--commit]
 *   node cli.js revenue <whatjobs|jobget|banana|all>
 *   node cli.js stats <daily|clicks|topost>
 *   node cli.js gxc <compare|list> [--company <name>]
 *   node cli.js client <qrm|hcsg>
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
import { runWhatJobsSync, runJobGetSync, runBananaSync, runAllRevenue } from "./scripts/revenue.js";
import { runDailyStats, runClicksReport, runToPostCheck } from "./scripts/stats.js";
import { listGxcCollections, runGxcCompare } from "./scripts/gxc.js";
import { runQrmAudit, runHcsgAudit } from "./scripts/clientFixer.js";
import { runGpdAudit, runGpdClean } from "./scripts/gpd.js";
import { cleanJobDescription, validateJobPostingSchema } from "./core/gfjSchema.js";
import { runCollisionCheck } from "./scripts/collision.js";

const program = new Command();

program
  .name("antigravity-nodejs")
  .description("High-Performance Multi-Tenant Operations & Command Center")
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

// 4. Feed Reconciliation
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

// 5. Daily Pipeline
program
  .command("pipeline")
  .description("Run daily proxy pipeline (updates -> expires)")
  .action(async () => {
    await runPipeline();
  });

// 6. Pre-Posting Ingestion Collision Gate
program
  .command("collision [clientName]")
  .description("Pre-posting collision detection (staging uniqueKey vs prod clientJobId)")
  .option("-l, --limit <number>", "Limit candidate uniqueKeys scanned", "5000")
  .action(async (clientName, opts) => {
    try {
      const res = await runCollisionCheck(clientName, { limit: parseInt(opts.limit, 10) });
      console.table(res);
    } finally {
      await mongo.close();
    }
  });

// 7. GPD Operations (Google Programmatic Distribution)
program
  .command("gpd <action>")
  .description("GPD Quality & Description Hygiene: audit, clean")
  .option("-c, --client <name>", "Filter by client name")
  .option("--commit", "Persist cleaned descriptions to database")
  .action(async (action, opts) => {
    try {
      const act = action.toLowerCase();
      if (act === "audit") {
        const res = await runGpdAudit({ client: opts.client });
        console.table(res);
      } else if (act === "clean") {
        const res = await runGpdClean({ client: opts.client, commit: opts.commit === true });
        console.log(res);
      } else {
        console.error(`Unknown GPD action: ${action}. Use: audit, clean`);
      }
    } finally {
      await mongo.close();
    }
  });

// 8. Schema Test Validator
program
  .command("schema:validate <title> <description>")
  .description("Test description cleaning & Google for Jobs schema compliance")
  .action((title, desc) => {
    const cleaned = cleanJobDescription(desc);
    const validation = validateJobPostingSchema({ title, description: cleaned, datePosted: new Date(), company: "Test Co" });
    console.log("\n=== Cleaned Description ===");
    console.log(cleaned);
    console.log("\n=== Schema Compliance Report ===");
    console.log(`Score: ${validation.score}% | Valid: ${validation.valid}`);
    if (validation.warnings.length) console.log("Warnings:", validation.warnings);
    if (validation.errors.length) console.log("Errors:", validation.errors);
  });

// 9. Revenue Operations (WhatJobs, JobGet, Banana)
program
  .command("revenue <action>")
  .description("Execute partner revenue sync: whatjobs, jobget, banana, all")
  .action(async (action) => {
    try {
      const act = action.toLowerCase();
      if (act === "whatjobs") {
        const res = await runWhatJobsSync();
        console.table(res);
      } else if (act === "jobget") {
        const res = await runJobGetSync();
        console.log(res);
      } else if (act === "banana") {
        const res = await runBananaSync();
        console.log(res);
      } else if (act === "all") {
        const res = await runAllRevenue();
        console.log(res);
      } else {
        console.error(`Unknown revenue action: ${action}. Use: whatjobs, jobget, banana, all`);
      }
    } finally {
      await mongo.close();
    }
  });

// 10. Stats & Clicks Telemetry
program
  .command("stats <action>")
  .description("Query cluster stats & clicks: daily, clicks, topost")
  .option("-d, --days <days>", "Trend window days (default: 7)", "7")
  .action(async (action, opts) => {
    try {
      const act = action.toLowerCase();
      if (act === "daily") {
        const res = await runDailyStats();
        console.table(res.clients);
      } else if (act === "clicks") {
        const res = await runClicksReport({ days: parseInt(opts.days, 10) });
        console.table(res.records);
      } else if (act === "topost") {
        const res = await runToPostCheck();
        console.table(res);
      } else {
        console.error(`Unknown stats action: ${action}. Use: daily, clicks, topost`);
      }
    } finally {
      await mongo.close();
    }
  });

// 11. GXC Feed Intelligence
program
  .command("gxc <action>")
  .description("GXC syndication feed operations: list, compare")
  .option("-c, --company <name>", "Filter by company name/regex (default: uber|doordash|albertsons...)")
  .action(async (action, opts) => {
    try {
      const act = action.toLowerCase();
      if (act === "list") {
        const cols = await listGxcCollections();
        console.log(`Found ${cols.length} collections:`);
        cols.slice(0, 30).forEach((c) => console.log(" ", c));
        if (cols.length > 30) console.log(` ... and ${cols.length - 30} more.`);
      } else if (act === "compare") {
        const res = await runGxcCompare({ company: opts.company });
        console.table(res.results.slice(0, 40));
        console.log(`\nMatched ${res.totalTitlesFound} total title groups across ${res.matchedFeedsCount} feeds.`);
      } else {
        console.error(`Unknown GXC action: ${action}. Use: list, compare`);
      }
    } finally {
      await mongo.close();
    }
  });

// 12. Client Operations & Fixers
program
  .command("client <clientName>")
  .description("Run client-specific diagnostics and scrubbing: qrm, hcsg")
  .action(async (clientName) => {
    try {
      const name = clientName.toLowerCase();
      if (name === "qrm") {
        const res = await runQrmAudit();
        console.log(res);
      } else if (name === "hcsg") {
        const res = await runHcsgAudit();
        console.log(res);
      } else {
        console.error(`Unknown client: ${clientName}. Available: qrm, hcsg`);
      }
    } finally {
      await mongo.close();
    }
  });

// 13. Ping
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

// 14. Serve API
program
  .command("serve")
  .description("Start the REST API server")
  .action(async () => {
    await import("./api.js");
  });

program.parse(process.argv);
