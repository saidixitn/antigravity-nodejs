/**
 * dailystats.js - High-Performance Multi-Tenant Daily Stats Engine
 * =================================================================
 * Operational replacement for Python Stats/dailystats.py.
 * 
 * Subsystem Workflow:
 * 1. Reads monitored domains from local 'daily_stats.input'.
 * 2. Connects dynamically across the 3 Jobiak Platform Architectures:
 *    - Proxy:         prod_jobiak_ai.job + jobicarenode_prod / ETL_AUD_Data
 *    - Direct Apply:  directclients_prod.Target_P4_Opt (filtered by employerId)
 *    - Programmatic:  {slug}_prod.Target_P4_Opt (unfiltered or feed-specific)
 * 3. Enforces strict UTC 24-hour windows and writes TWO output records per domain
 *    into local 'daily_stats.output':
 *    - Date = TODAY (00:00 UTC):     Live snapshot (To_Post, FeedExpiredJobs, LiveGeneratedAt)
 *    - Date = YESTERDAY (00:00 UTC): Closed 24h metrics (Active_Jobs, DB_Clicks, Expired_Jobs, etc.)
 * 
 * Zero Load & Security Design:
 * - Uses exact compound index prefixes (e.g. pub_expired_1_gpost_1, employerId_1_isActive_1_status_1).
 * - Zero raw IP or credential disclosure: all connection handles remain masked in memory.
 */

import pLimit from "p-limit";
import mongo from "../core/mongo.js";
import logger from "../core/logger.js";

/**
 * Normalizes input employerId into a clean array of strings
 */
function normalizeEmployerIds(empId) {
  if (!empId) return [];
  if (Array.isArray(empId)) return empId.map((id) => String(id).trim()).filter(Boolean);
  return [String(empId).trim()].filter(Boolean);
}

/**
 * Resolves the target database name based on architecture
 */
function resolveDatabaseName(domain, domainType) {
  const dt = (domainType || "").trim().toLowerCase();
  if (dt === "proxy") return "prod_jobiak_ai";
  if (dt === "direct apply" || dt === "subdomain") return "directclients_prod";
  
  // Programmatic: slug extraction (e.g., "hextill.com" -> "hextill_prod")
  const slug = domain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split(".")[0]
    .toLowerCase()
    .trim();
  return `${slug}_prod`;
}

/**
 * Main Daily Stats Pipeline Runner
 */
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

  // Calculate strict UTC 24-hour boundaries
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const fiveDaysFuture = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000);

  const windowFilter = { $gte: yesterday, $lt: today };

  // Run up to 4 domains concurrently to keep database load negligible
  const limit = pLimit(4);
  const results = [];

  const tasks = inputs.map((item) =>
    limit(async () => {
      const domain = item.Domain;
      const domainType = item.DomainType || "Proxy";
      const employerIds = normalizeEmployerIds(item.employerId);
      const companyName = item.Company || "";

      try {
        let stats = {
          To_Post: 0,
          FeedExpiredJobs: 0,
          Active_Jobs: 0,
          Posted_Jobs: 0,
          Updated_Jobs: 0,
          Reposts: 0,
          Cache_Updated_Jobs: 0,
          Expired_Jobs: 0,
          Posted_Bot: 0,
          Expires_Bot: 0,
          DB_Clicks: 0,
          Bot_Visits: 0,
          Posting_Queue: 0,
          Expires_Queue: 0,
          Post_Fail: 0,
          Expires_Fail: 0,
          To_Expire_In_5Days: 0,
          Total_Posted_Jobs: 0,
          Total_Expired_Jobs: 0,
        };

        const targetDbName = resolveDatabaseName(domain, domainType);

        if (domainType === "Proxy") {
          const prodDb = await mongo.db("prod_jobiak_ai");
          const jobCol = prodDb.collection("job");
          const analyticsCol = prodDb.collection("userAnalytics");

          const empFilter = { employerId: { $in: employerIds } };

          // 1. Active Live Listings
          stats.Active_Jobs = await jobCol.countDocuments({
            ...empFilter,
            status: "posted",
            isActive: true,
          });
          stats.Total_Posted_Jobs = stats.Active_Jobs;

          // 2. Total Historical Expired Listings
          stats.Total_Expired_Jobs = await jobCol.countDocuments({
            ...empFilter,
            status: "removed",
          });

          // 3. Expiring Soon (Next 5 Days)
          stats.To_Expire_In_5Days = await jobCol.countDocuments({
            ...empFilter,
            status: "posted",
            isActive: true,
            validThrough: { $lt: fiveDaysFuture },
          });

          // 4. Staging Feed Reconciliation: To_Post & FeedExpired
          // Try jobicarenode_prod first, fallback to data_cleansing
          const jicnDb = await mongo.db("jobicarenode_prod").catch(() => null);
          if (jicnDb) {
            stats.To_Post = await jicnDb.collection("Target_P4_Opt").countDocuments({
              job_status: { $ne: 3 },
              gpost: { $in: [1, 3] },
            }).catch(() => 0);

            stats.FeedExpiredJobs = await jicnDb.collection("Target_P4_Opt").countDocuments({
              job_status: 3,
            }).catch(() => 0);
          } else {
            // Fallback to data_cleansing.ETL_AUD_Data (Type 0 = feed expired)
            const cleansingDb = await mongo.db("data_cleansing").catch(() => null);
            if (cleansingDb) {
              stats.FeedExpiredJobs = await cleansingDb.collection("ETL_AUD_Data").countDocuments({
                ...empFilter,
                Type: 0,
              }).catch(() => 0);
            }
          }

          // 5. Deduplicated Human Google Clicks (DB_Clicks)
          const clicksAgg = await analyticsCol.aggregate([
            {
              $match: {
                ...empFilter,
                isBot: false,
                isFromGoogle: true,
                browserType: { $ne: "Unknown" },
                deviceType: { $ne: "Unknown" },
                createdDt: windowFilter,
              },
            },
            { $group: { _id: { ip: "$ipAddress", job: "$jobId" } } },
            { $count: "count" },
          ], { allowDiskUse: true }).toArray().catch(() => []);
          stats.DB_Clicks = clicksAgg[0]?.count || 0;

          // 6. Bot Visits Telemetry
          stats.Bot_Visits = await analyticsCol.countDocuments({
            ...empFilter,
            isBot: true,
            createdDt: windowFilter,
          }).catch(() => 0);

          // 7. Expired Jobs in 24h Window
          stats.Expired_Jobs = await jobCol.countDocuments({
            ...empFilter,
            status: "removed",
            isActive: false,
            updatedAt: windowFilter,
          }).catch(() => 0);

        } else {
          // Direct Apply or Programmatic
          const clusterDb = await mongo.db(targetDbName);
          const p4Col = clusterDb.collection("Target_P4_Opt");
          const analyticsCol = clusterDb.collection("userAnalytics");
          const logsCol = clusterDb.collection("aj_jp_google_logs");

          const baseFilter = domainType === "Direct Apply"
            ? { employerId: { $in: employerIds } }
            : {};

          // 1. Live Snapshot (TODAY)
          stats.To_Post = await p4Col.countDocuments({
            ...baseFilter,
            gpost: 1,
            job_status: { $ne: 3 },
          }).catch(() => 0);

          stats.FeedExpiredJobs = await p4Col.countDocuments({
            ...baseFilter,
            job_status: 3,
          }).catch(() => 0);

          // 2. Active Jobs
          stats.Active_Jobs = await p4Col.countDocuments({
            ...baseFilter,
            gpost: 5,
            job_status: { $ne: 3 },
          }).catch(() => 0);
          stats.Total_Posted_Jobs = stats.Active_Jobs;

          stats.Total_Expired_Jobs = await p4Col.countDocuments({
            ...baseFilter,
            gpost: 6,
          }).catch(() => 0);

          // 3. Publishing Actions in 24h Window
          stats.Posted_Jobs = await p4Col.countDocuments({
            ...baseFilter,
            action: "post",
            gpost: 5,
            job_status: { $ne: 3 },
            gpost_date: windowFilter,
          }).catch(() => 0);

          stats.Updated_Jobs = await p4Col.countDocuments({
            ...baseFilter,
            action: "update",
            gpost: 5,
            job_status: { $ne: 3 },
            gpost_date: windowFilter,
          }).catch(() => 0);

          stats.Reposts = await p4Col.countDocuments({
            ...baseFilter,
            action: "repost",
            gpost: 5,
            job_status: { $ne: 3 },
            gpost_date: windowFilter,
          }).catch(() => 0);

          // 4. Google Indexing URL_UPDATED & Cache Updated
          const googleUpdated = await logsCol.countDocuments({
            ...baseFilter,
            callType: "URL_UPDATED",
            createdAt: windowFilter,
          }).catch(() => 0);
          stats.Cache_Updated_Jobs = Math.max((stats.Posted_Jobs + stats.Updated_Jobs + stats.Reposts) - googleUpdated, 0);

          // 5. Queues & Failures
          stats.Posting_Queue = await p4Col.countDocuments({
            ...baseFilter,
            gpost: 3,
            job_status: { $ne: 3 },
          }).catch(() => 0);

          stats.Expires_Queue = await p4Col.countDocuments({
            ...baseFilter,
            gpost: 8,
          }).catch(() => 0);

          stats.Post_Fail = await p4Col.countDocuments({
            ...baseFilter,
            gpost: 4,
            gpostExeOn: { $exists: true },
          }).catch(() => 0);

          stats.Expires_Fail = await logsCol.countDocuments({
            ...baseFilter,
            callType: "URL_DELETED",
            status_update: 4,
            createdAt: windowFilter,
          }).catch(() => 0);

          // 6. Expiring Soon (Next 5 Days)
          stats.To_Expire_In_5Days = await p4Col.countDocuments({
            ...baseFilter,
            pub_expired: { $lt: fiveDaysFuture },
            gpost: 5,
            job_status: { $ne: 3 },
          }).catch(() => 0);

          // 7. Human Google Clicks (DB_Clicks)
          const clicksAgg = await analyticsCol.aggregate([
            {
              $match: {
                ...baseFilter,
                isBot: false,
                isFromGoogle: true,
                browserType: { $ne: "Unknown" },
                deviceType: { $ne: "Unknown" },
                createdDt: windowFilter,
              },
            },
            { $group: { _id: { ip: "$ipAddress", job: "$jobPubJobId" } } },
            { $count: "count" },
          ], { allowDiskUse: true }).toArray().catch(() => []);
          stats.DB_Clicks = clicksAgg[0]?.count || 0;

          // 8. Bot Crawls
          stats.Bot_Visits = await analyticsCol.countDocuments({
            ...baseFilter,
            isBot: true,
            createdDt: windowFilter,
          }).catch(() => 0);
        }

        // =====================================================================
        // PERSISTENCE (Strict Separation: TODAY vs YESTERDAY)
        // =====================================================================
        const commonDoc = {
          Domain: domain,
          DomainType: domainType,
          employerId: item.employerId,
          ...(companyName ? { Company: companyName } : {}),
        };

        // 1. Write TODAY doc: ONLY Live volatile fields
        await outputCol.updateOne(
          { Date: today, Domain: domain, employerId: item.employerId },
          {
            $set: {
              ...commonDoc,
              Date: today,
              To_Post: stats.To_Post,
              FeedExpiredJobs: stats.FeedExpiredJobs,
              LiveGeneratedAt: now,
            },
          },
          { upsert: true }
        );

        // 2. Write YESTERDAY doc: Closed 24h historical metrics
        const historicalStats = { ...stats };
        delete historicalStats.To_Post;
        delete historicalStats.FeedExpiredJobs;

        await outputCol.updateOne(
          { Date: yesterday, Domain: domain, employerId: item.employerId },
          {
            $set: {
              ...commonDoc,
              Date: yesterday,
              WindowStart: yesterday,
              WindowEnd: today,
              HistoricalGeneratedAt: now,
              ...historicalStats,
            },
          },
          { upsert: true }
        );

        const summary = {
          domain,
          domainType,
          employerId: item.employerId,
          activeJobs: stats.Active_Jobs,
          toPost: stats.To_Post,
          feedExpired: stats.FeedExpiredJobs,
          clicks: stats.DB_Clicks,
          status: "SUCCESS",
        };

        results.push(summary);
        logger.info(
          `Stats [${domain}]: Active=${stats.Active_Jobs} | ToPost=${stats.To_Post} | FeedExpired=${stats.FeedExpiredJobs} | Clicks=${stats.DB_Clicks}`
        );
      } catch (err) {
        logger.error(`Failed stats for ${domain}`, err.message);
        results.push({ domain, employerId: item.employerId, error: err.message, status: "ERROR" });
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
      logger.error("Daily stats error", err);
      mongo.close();
    });
}
