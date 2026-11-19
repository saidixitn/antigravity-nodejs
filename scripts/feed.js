/**
 * feed.js - Multi-Tenant XML Feed & Production Reconciliation Engine
 * ==================================================================
 * Replaces: feed.py
 * 
 * Reconciles staging Target_P4_Opt in jobicarenode_prod against
 * posted production jobs in prod_jobiak_ai.
 */

import mongo from "../core/mongo.js";
import { loadClientsConfig } from "../core/auth.js";
import logger from "../core/logger.js";

export async function runFeedReconciliation() {
  logger.section("Feed & Production Reconciliation");

  const prodDb = await mongo.db("prod_jobiak_ai");
  const jobicareDb = await mongo.db("jobicarenode_prod");

  const jobCol = prodDb.collection("job");
  const p4Col = jobicareDb.collection("Target_P4_Opt");

  const clients = loadClientsConfig();
  if (!clients || clients.length === 0) {
    logger.warn("No clients configured in clients.json");
    return [];
  }

  const summary = [];

  for (const client of clients) {
    // 1. Staging candidate jobs (job_status != 3)
    const stagingCount = await p4Col.countDocuments({
      employerId: client.jobicareEmployerId,
      job_status: { $ne: 3 },
    });

    // 2. Active production posted jobs
    const activeProdCount = await jobCol.countDocuments({
      employerId: client.employerId,
      status: "posted",
      isActive: true,
    });

    // 3. Inactive or expired in production
    const expiredProdCount = await jobCol.countDocuments({
      employerId: client.employerId,
      $or: [{ status: { $ne: "posted" } }, { isActive: false }],
    });

    const report = {
      client: client.name,
      employerId: client.employerId,
      stagingEligible: stagingCount,
      activeProduction: activeProdCount,
      expiredProduction: expiredProdCount,
      gap: stagingCount - activeProdCount,
    };

    summary.push(report);
    logger.info(`Reconciled ${client.name}`, `Staging: ${stagingCount} | Active: ${activeProdCount} | Gap: ${report.gap}`);
  }

  logger.section("Reconciliation Summary");
  logger.table(summary);
  return summary;
}

if (process.argv[1]?.endsWith("feed.js")) {
  runFeedReconciliation()
    .then(async () => {
      await mongo.close();
      process.exit(0);
    })
    .catch(async (e) => {
      logger.error("Feed reconciliation failed", e);
      await mongo.close();
      process.exit(1);
    });
}

export default runFeedReconciliation;
