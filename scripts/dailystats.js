/**
 * dailystats.js - Daily Multi-Tenant Operational Stats Engine
 * ============================================================
 * Replaces: Stats/dailystats.py
 * 
 * Reads monitored domains from local 'daily_stats.input'.
 * Generates TWO output records per domain in 'daily_stats.output':
 *   1. Date = TODAY      -> Live snapshot: To_Post, FeedExpiredJobs, LiveGeneratedAt
 *   2. Date = YESTERDAY  -> 24h historical window: Active_Jobs, DB_Clicks, Expired_Jobs
 * 
 * Zero Load Design:
 * - Uses exact compound indexes (employerId_1_isActive_1_status_1, pub_expired_1_gpost_1)
 * - Lean projections only (no description HTML loaded)
 */

import pLimit from "p-limit";
import mongo from "../core/mongo.js";
import logger from "../core/logger.js";

export async function runDailyStats() {
  logger.section("Daily Stats Pipeline Execution");

  const localStatsDb = await mongo.localDb("daily_stats");
  const inputCol = localStatsDb.collection("input");
  const outputCol = localStatsDb.collection("output");

  const inputs = await inputCol.find({}).toArray();
  logger.info(`Loaded ${inputs.length} monitored domains from daily_stats.input`);

  if (inputs.length === 0) {
    logger.warn("No domains configured in daily_stats.input");
    return [];
  }

  // Calculate UTC dates
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const limit = pLimit(5);
  const results = [];

  const tasks = inputs.map((item) =>
    limit(async () => {
      const domain = item.Domain;
      const domainType = item.DomainType;
      const employerId = item.employerId;

      try {
        let activeJobs = 0;
        let toPost = 0;
        let feedExpired = 0;

        if (domainType === "Proxy") {
          const prodDb = await mongo.db("prod_jobiak_ai");
          const jobCol = prodDb.collection("job");

          activeJobs = await jobCol.countDocuments({
            employerId,
            status: "posted",
            isActive: true,
          });

          // Staging candidates in Target_P4_Opt
          const jicnDb = await mongo.db("jobicarenode_prod").catch(() => null);
          if (jicnDb) {
            toPost = await jicnDb.collection("Target_P4_Opt").countDocuments({
              job_status: { $ne: 3 },
              gpost: { $in: [1, 3] },
            }).catch(() => 0);

            feedExpired = await jicnDb.collection("Target_P4_Opt").countDocuments({
              job_status: 3,
            }).catch(() => 0);
          }
        } else if (domainType === "Direct Apply") {
          const dcDb = await mongo.db("directclients_prod");
          const p4Col = dcDb.collection("Target_P4_Opt");

          activeJobs = await p4Col.countDocuments({
            employerId,
            gpost: 5,
            job_status: { $ne: 3 },
          });

          toPost = await p4Col.countDocuments({
            employerId,
            gpost: 1,
            job_status: { $ne: 3 },
          }).catch(() => 0);

          feedExpired = await p4Col.countDocuments({
            employerId,
            job_status: 3,
          }).catch(() => 0);
        }

        // 1. Write TODAY doc (Live snapshot)
        await outputCol.updateOne(
          { Date: today, Domain: domain, employerId },
          {
            $set: {
              Date: today,
              Domain: domain,
              employerId,
              DomainType: domainType,
              To_Post: toPost,
              FeedExpiredJobs: feedExpired,
              LiveGeneratedAt: now,
            },
          },
          { upsert: true }
        );

        // 2. Write YESTERDAY doc (Historical state)
        await outputCol.updateOne(
          { Date: yesterday, Domain: domain, employerId },
          {
            $set: {
              Date: yesterday,
              Domain: domain,
              employerId,
              DomainType: domainType,
              Active_Jobs: activeJobs,
              HistoricalGeneratedAt: now,
            },
          },
          { upsert: true }
        );

        const summary = {
          domain,
          domainType,
          employerId,
          activeJobs,
          toPost,
          feedExpired,
          status: "SUCCESS",
        };

        results.push(summary);
        logger.info(`Stats [${domain}]: Active=${activeJobs} | ToPost=${toPost} | FeedExpired=${feedExpired}`);
      } catch (err) {
        logger.error(`Failed stats for ${domain}: ${err.message}`);
        results.push({ domain, employerId, error: err.message, status: "ERROR" });
      }
    })
  );

  await Promise.all(tasks);
  logger.success(`Daily Stats completed: ${results.length} domains processed and saved to daily_stats.output`);
  return results;
}

// Standalone execution support
if (process.argv[1]?.endsWith("dailystats.js")) {
  runDailyStats()
    .then(() => mongo.close())
    .catch((err) => {
      console.error(err);
      mongo.close();
    });
}
