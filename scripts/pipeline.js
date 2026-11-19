/**
 * pipeline.js - Daily Proxy Execution Pipeline
 * ============================================
 * Replaces: run_proxy_updates_expires.py
 * 
 * Sequentially runs:
 *   1. scripts/updates.js
 *   2. scripts/expires.js
 */

import mongo from "../core/mongo.js";
import { runUpdates } from "./updates.js";
import { runExpires } from "./expires.js";
import logger from "../core/logger.js";

export async function runPipeline() {
  const start = Date.now();
  logger.section("Daily Proxy Pipeline");

  let okUpdates = false;
  let okExpires = false;

  try {
    logger.info("Executing Step 1: Proxy Sliding Updates...");
    await runUpdates();
    okUpdates = true;
    logger.success("Step 1 (Updates) Completed");
  } catch (err) {
    logger.error("Step 1 (Updates) Failed", err);
  }

  try {
    logger.info("Executing Step 2: Zero-Click Expires...");
    await runExpires();
    okExpires = true;
    logger.success("Step 2 (Expires) Completed");
  } catch (err) {
    logger.error("Step 2 (Expires) Failed", err);
  }

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  logger.section("Pipeline Results");
  logger.info(`Total Execution Time: ${durationSec}s`);
  logger.info(`Updates Status: ${okUpdates ? "SUCCESS" : "FAILED"}`);
  logger.info(`Expires Status: ${okExpires ? "SUCCESS" : "FAILED"}`);

  await mongo.close();

  if (!okUpdates || !okExpires) {
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("pipeline.js")) {
  runPipeline();
}

export default runPipeline;
