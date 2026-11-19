/**
 * indexingAudit.js - Googlebot Crawl vs View Bottleneck Analyzer
 * ==============================================================
 * Replaces: export_hcsg_no_views.py, generate_hcsg_views_excel.py
 * 
 * Partitions live posted jobs into 3 critical operational buckets:
 * 1. Generating Views: Active listings capturing organic human Google clicks.
 * 2. Crawled but No Views: Googlebot crawled the page, but Google for Jobs
 *    did not rank it or searchers didn't click (CTR/Title/Salary issue).
 * 3. Never Crawled: Googlebot has never visited the URL (Indexing bottleneck;
 *    needs Google Indexing API or sitemap push).
 */

import pLimit from "p-limit";
import mongo from "../core/mongo.js";
import { loadClientsConfig } from "../core/auth.js";
import logger from "../core/logger.js";

export async function runIndexingAudit(clientName = "HCSG", options = {}) {
  logger.section(`Googlebot Crawl & Indexing Audit: ${clientName}`);

  const clients = loadClientsConfig();
  const client = clients.find((c) => c.name.toLowerCase().includes(clientName.toLowerCase()));
  if (!client) {
    throw new Error(`Client '${clientName}' not found in clients.json`);
  }

  const prodDb = await mongo.db("prod_jobiak_ai");
  const jobCol = prodDb.collection("job");
  const analyticsCol = prodDb.collection("userAnalytics");

  logger.info(`Auditing live jobs for ${client.name} (${client.employerId})...`);

  const activeJobs = await jobCol
    .find(
      { employerId: client.employerId, status: "posted", isActive: true },
      { projection: { jobId: 1, title: 1, city: 1, state: 1, datePosted: 1, submittedUrl: 1 } }
    )
    .limit(options.limit || 2000)
    .toArray();

  if (activeJobs.length === 0) {
    logger.warn(`No active posted jobs found for ${client.name}`);
    return { client: client.name, total: 0 };
  }

  logger.info(`Analyzing ${activeJobs.length} active jobs against userAnalytics telemetry...`);

  let generatingViewsCount = 0;
  let crawledNoViewsCount = 0;
  let neverCrawledCount = 0;

  const limit = pLimit(10);
  const sampleNeverCrawled = [];
  const sampleCrawledNoViews = [];

  const tasks = activeJobs.map((job) =>
    limit(async () => {
      const jid = String(job.jobId || job._id);

      // Check human Google views
      const humanViews = await analyticsCol
        .countDocuments({
          employerId: client.employerId,
          $or: [{ jobId: jid }, { childJobId: jid }],
          isBot: false,
          isFromGoogle: true,
        })
        .catch(() => 0);

      if (humanViews > 0) {
        generatingViewsCount++;
        return;
      }

      // Check bot crawl visits (Googlebot)
      const botVisits = await analyticsCol
        .countDocuments({
          employerId: client.employerId,
          $or: [{ jobId: jid }, { childJobId: jid }],
          isBot: true,
        })
        .catch(() => 0);

      if (botVisits > 0) {
        crawledNoViewsCount++;
        if (sampleCrawledNoViews.length < 10) {
          sampleCrawledNoViews.push({
            jobId: jid,
            title: job.title,
            location: `${job.city || ""}, ${job.state || ""}`,
            botVisits,
            diagnostic: "CRAWLED_ZERO_CLICKS (Optimize title/snippet)",
          });
        }
      } else {
        neverCrawledCount++;
        if (sampleNeverCrawled.length < 10) {
          sampleNeverCrawled.push({
            jobId: jid,
            title: job.title,
            location: `${job.city || ""}, ${job.state || ""}`,
            diagnostic: "NEVER_CRAWLED (Push to Indexing API)",
          });
        }
      }
    })
  );

  await Promise.all(tasks);

  const total = activeJobs.length;
  const summary = {
    client: client.name,
    employerId: client.employerId,
    totalActiveAudited: total,
    generatingViews: {
      count: generatingViewsCount,
      percentage: ((generatingViewsCount / total) * 100).toFixed(1) + "%",
    },
    crawledZeroClicks: {
      count: crawledNoViewsCount,
      percentage: ((crawledNoViewsCount / total) * 100).toFixed(1) + "%",
      sample: sampleCrawledNoViews,
    },
    neverCrawled: {
      count: neverCrawledCount,
      percentage: ((neverCrawledCount / total) * 100).toFixed(1) + "%",
      sample: sampleNeverCrawled,
    },
  };

  logger.success(`Indexing Audit Complete for ${client.name}:`);
  logger.info(`  • Generating Views: ${summary.generatingViews.count} (${summary.generatingViews.percentage})`);
  logger.info(`  • Crawled Zero Clicks: ${summary.crawledZeroClicks.count} (${summary.crawledZeroClicks.percentage})`);
  logger.info(`  • Never Crawled: ${summary.neverCrawled.count} (${summary.neverCrawled.percentage})`);

  return summary;
}
