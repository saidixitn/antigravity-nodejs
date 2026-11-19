/**
 * stats.js - Operational Telemetry, Clicks & Staging Analytics
 * ==============================================================
 * Replaces: Stats/clicks_report.py, Stats/dailystats.py, Stats/to_post.py
 * 
 * Extracts click activity from userAnalytics, computes cluster-wide health counts,
 * and audits pending unposted staging inventory across multi-tenant clients.
 */

import pLimit from "p-limit";
import mongo from "../core/mongo.js";
import { loadClientsConfig } from "../core/auth.js";
import logger from "../core/logger.js";

/**
 * 1. DAILY CLUSTER STATS
 * Aggregates active, inactive, and total inventory across tenant databases.
 */
export async function runDailyStats(options = {}) {
  logger.section("Daily Multi-Tenant Cluster Statistics");

  const clients = loadClientsConfig();
  if (!clients || clients.length === 0) {
    throw new Error("No clients found in clients.json");
  }

  const limit = pLimit(5);
  const results = [];

  logger.info(`Analyzing daily listing stats for ${clients.length} clients...`);

  const tasks = clients.map((client) =>
    limit(async () => {
      try {
        const prodDb = await mongo.db("prod_jobiak_ai");
        const jobCol = prodDb.collection("job");

        const activeCount = await jobCol.countDocuments({
          employerId: client.employerId,
          status: "posted",
          isActive: true,
        });

        const inactiveCount = await jobCol.countDocuments({
          employerId: client.employerId,
          isActive: false,
        });

        const totalCount = await jobCol.countDocuments({
          employerId: client.employerId,
        });

        const stat = {
          client: client.name,
          domain: client.domain,
          employerId: client.employerId,
          active: activeCount,
          inactive: inactiveCount,
          total: totalCount,
          activePercentage: totalCount > 0 ? ((activeCount / totalCount) * 100).toFixed(1) + "%" : "0%",
        };

        results.push(stat);
        logger.info(`Stats [${client.name}]: ${activeCount} active / ${totalCount} total (${stat.activePercentage})`);
      } catch (err) {
        logger.error(`Error gathering stats for ${client.name}: ${err.message}`);
        results.push({
          client: client.name,
          domain: client.domain,
          error: err.message,
        });
      }
    })
  );

  await Promise.all(tasks);

  const totalActive = results.reduce((acc, r) => acc + (r.active || 0), 0);
  const totalAll = results.reduce((acc, r) => acc + (r.total || 0), 0);

  logger.success(`Daily Stats completed: ${totalActive} active across ${totalAll} total records`);

  return {
    timestamp: new Date().toISOString(),
    summary: { totalActive, totalAll, clientsAudited: results.length },
    clients: results,
  };
}

/**
 * 2. CLICKS REPORT & TELEMETRY
 * Aggregates click interactions from userAnalytics over the trend window.
 */
export async function runClicksReport(options = {}) {
  const days = options.days || 7;
  logger.section(`Clicks & Telemetry Report (Past ${days} Days)`);

  const analyticsDb = await mongo.db("prod_jobiak_ai");
  const analyticsCol = analyticsDb.collection("userAnalytics");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  logger.info(`Extracting click telemetry since ${cutoff.toISOString().substring(0, 10)}...`);

  // Pipeline to aggregate clicks by domain and date
  const pipeline = [
    {
      $match: {
        created_at: { $gte: cutoff },
        event_type: { $in: ["click", "apply_click", "job_click"] },
      },
    },
    {
      $group: {
        _id: {
          domain: "$domain",
          date: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
        },
        totalClicks: { $sum: 1 },
      },
    },
    { $sort: { "_id.date": -1, totalClicks: -1 } },
    { $limit: 100 },
  ];

  let clicks = [];
  try {
    clicks = await analyticsCol.aggregate(pipeline).toArray();
    logger.info(`Aggregated ${clicks.length} click activity metrics`);
  } catch (err) {
    logger.warn(`userAnalytics aggregation notice: ${err.message}. Using fallback count.`);
    const count = await analyticsCol.countDocuments({ created_at: { $gte: cutoff } }).catch(() => 0);
    clicks = [{ summary: "Total events in period", count }];
  }

  logger.success(`Clicks Report ready: ${clicks.length} trend buckets computed`);
  return {
    days,
    since: cutoff.toISOString(),
    records: clicks,
  };
}

/**
 * 3. TO-POST STAGING INVENTORY CHECK
 * Evaluates pending jobs in Target_P4_Opt waiting to be posted to production.
 */
export async function runToPostCheck(options = {}) {
  logger.section("To-Post Staging Queue Evaluation");

  const jobicareDb = await mongo.db("jobicarenode_prod");
  const p4Col = jobicareDb.collection("Target_P4_Opt");

  const clients = loadClientsConfig();
  const summary = [];

  for (const client of clients) {
    const pendingCount = await p4Col.countDocuments({
      employerId: client.jobicareEmployerId,
      job_status: { $ne: 3 },
    });

    summary.push({
      client: client.name,
      jobicareEmployerId: client.jobicareEmployerId,
      pendingToPost: pendingCount,
    });

    logger.info(`To-Post [${client.name}]: ${pendingCount} listings awaiting promotion in staging`);
  }

  logger.success("To-Post staging evaluation completed");
  return summary;
}
