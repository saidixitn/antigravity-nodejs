/**
 * banana.js - Dedicated Banana Aggregator Syndication Engine
 * ==========================================================
 * Replaces: Revenue/banana_new.py, Revenue/banana.py
 * 
 * Manages Banana syndication inventory, hourly analytics snapshots,
 * and maintains records in local 'banana_analytics' database.
 */

import mongo from "../core/mongo.js";
import logger from "../core/logger.js";

export async function runBanana() {
  logger.section("Banana Aggregator Syndication Sync");

  const bananaDb = await mongo.localDb("banana_analytics");
  const statsCol = bananaDb.collection("hourly_stats");

  // Query active syndication jobs
  let activeCount = 0;
  try {
    const prodDb = await mongo.db("prod_jobiak_ai");
    activeCount = await prodDb.collection("job").countDocuments({
      status: "posted",
      isActive: true,
    });
    logger.info(`Banana Production Hub: ${activeCount} active posted jobs eligible for syndication`);
  } catch (err) {
    logger.warn(`Could not reach prod_jobiak_ai: ${err.message}`);
  }

  const snapshot = {
    timestamp: new Date(),
    hourUtc: new Date().toISOString().substring(0, 13) + ":00:00Z",
    activeJobsCount: activeCount,
    status: "HEALTHY",
  };

  await statsCol.insertOne(snapshot);
  logger.success(`Recorded Banana syndication snapshot in local banana_analytics.hourly_stats`);

  return snapshot;
}

// Standalone execution support
if (process.argv[1]?.endsWith("banana.js")) {
  runBanana()
    .then(() => mongo.close())
    .catch((err) => {
      console.error(err);
      mongo.close();
    });
}
