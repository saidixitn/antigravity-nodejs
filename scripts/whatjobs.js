/**
 * whatjobs.js - Dedicated WhatJobs Revenue & URL-Matching Engine
 * ==============================================================
 * Replaces: Revenue/whatjobs.py
 * 
 * Extracts WhatJobs-referred human Google views from userAnalytics,
 * extracts numeric job IDs via regex (___[0-9]+_([0-9]{5,})__),
 * and reconciles metrics into local 'whatjobs_revenue' database.
 */

import pLimit from "p-limit";
import mongo from "../core/mongo.js";
import googlesheet from "../core/googlesheet.js";
import { env, loadClientsConfig } from "../core/auth.js";
import logger from "../core/logger.js";

// Extract WhatJobs numeric jobId from tracking URL
export function extractWhatJobsId(url) {
  if (!url) return null;
  const s = String(url);
  const m1 = s.match(/___[0-9]+_([0-9]{5,})__/);
  if (m1) return m1[1];
  const m2 = s.match(/_(\d{5,})__/);
  if (m2) return m2[1];
  const m3 = s.match(/(\d{6,})/);
  if (m3) return m3[1];
  return null;
}

export async function runWhatJobs() {
  logger.section("WhatJobs Traffic & Revenue Extraction");

  const wjDb = await mongo.localDb("whatjobs_revenue");
  const viewsCol = wjDb.collection("wj_views");
  const statsCol = wjDb.collection("wj_stats");

  const clients = loadClientsConfig();
  const domains = clients.map((c) => c.domain).filter(Boolean);
  logger.info(`Scanning WhatJobs traffic across ${domains.length} client domains...`);

  const limit = pLimit(5);
  const extractedRecords = [];

  const tasks = domains.map((domain) =>
    limit(async () => {
      try {
        const prodDb = await mongo.db("prod_jobiak_ai");
        const analyticsCol = prodDb.collection("userAnalytics");

        // WhatJobs Pure Human Google View Pipeline
        const pipeline = [
          {
            $match: {
              isBot: false,
              isFromGoogle: true,
              browserType: { $ne: "Unknown" },
              deviceType: { $ne: "Unknown" },
              $or: [
                { "extraInfo.sourceEmployerId": { $regex: "whatjobs", $options: "i" } },
                { "extraInfo.url": { $regex: "^https://www\\.whatjobs\\.com", $options: "i" } },
              ],
            },
          },
          {
            $project: {
              _id: 1,
              domain: 1,
              jobId: 1,
              childJobId: 1,
              createdDt: 1,
              url: "$extraInfo.url",
              sourceEmployerId: "$extraInfo.sourceEmployerId",
            },
          },
          { $limit: 1000 },
        ];

        const docs = await analyticsCol.aggregate(pipeline).toArray();

        for (const doc of docs) {
          const cleanJobId = extractWhatJobsId(doc.url) || doc.jobId || doc.childJobId;
          extractedRecords.push({
            domain,
            rawId: doc._id,
            jobId: cleanJobId,
            url: doc.url,
            createdDt: doc.createdDt,
            extractedAt: new Date(),
          });
        }

        logger.info(`WhatJobs [${domain}]: Extracted ${docs.length} matching view events`);
      } catch (err) {
        logger.error(`WhatJobs scan failed for ${domain}: ${err.message}`);
      }
    })
  );

  await Promise.all(tasks);

  // Save to local whatjobs_revenue
  if (extractedRecords.length > 0) {
    const ops = extractedRecords.map((r) => ({
      updateOne: {
        filter: { rawId: r.rawId },
        update: { $set: r },
        upsert: true,
      },
    }));
    await viewsCol.bulkWrite(ops);
    logger.success(`Saved ${extractedRecords.length} records into local whatjobs_revenue.wj_views`);
  }

  // Update summary stats
  const summary = {
    runDate: new Date(),
    domainsScanned: domains.length,
    totalViewsExtracted: extractedRecords.length,
    status: "COMPLETED",
  };
  await statsCol.insertOne(summary);

  // Optional: Update Google Sheet if WHATJOBS_SPREADSHEET_ID is set
  if (env.whatjobsSpreadsheetId) {
    try {
      const rows = [[new Date().toISOString(), domains.length, extractedRecords.length, "COMPLETED"]];
      await googlesheet.append(env.whatjobsSpreadsheetId, "Stats!A:D", rows);
    } catch {
      // Ignore sheet errors if tab doesn't exist
    }
  }

  logger.success("WhatJobs sync finished successfully");
  return summary;
}

// Standalone execution support
if (process.argv[1]?.endsWith("whatjobs.js")) {
  runWhatJobs()
    .then(() => mongo.close())
    .catch((err) => {
      console.error(err);
      mongo.close();
    });
}
