/**
 * views.js - Monthly Unique Views & Click Attribution Engine
 * ==========================================================
 * Replaces: hariprasad.py (Tarun Monthly Stats)
 * 
 * Aggregates monthly unique clicks for any Lead or all leads.
 * Deduplicates per UTC date + IP + Job ID.
 */

import pLimit from "p-limit";
import mongo from "../core/mongo.js";
import googlesheet from "../core/googlesheet.js";
import { env } from "../core/auth.js";
import { GOOGLE_VIEW_FILTER, buildViewProjectionStage } from "../core/query.js";
import logger from "../core/logger.js";

const INPUT_SHEET = "Domains";
const OUTPUT_SHEET = "Tarun monthly stats";

/**
 * Direct Apply: userAnalytics + userAnalytics_old
 */
async function getDirectApplyMonthly(employerId) {
  const coll = await mongo.col("directclients_prod", "userAnalytics");

  const pipeline = [
    { $match: { employerId, ...GOOGLE_VIEW_FILTER, createdDt: { $type: "date" } } },
    ...buildViewProjectionStage("createdDt"),
    {
      $unionWith: {
        coll: "userAnalytics_old",
        pipeline: [
          { $match: { employerId, ...GOOGLE_VIEW_FILTER, createdDt: { $type: "date" } } },
          ...buildViewProjectionStage("createdDt"),
          { $project: { day: 1, ip: 1, jobId: 1, isOld: { $literal: 1 } } },
        ],
      },
    },
    {
      $group: {
        _id: { day: "$day", ip: "$ip", jobId: "$jobId" },
        hasCurrent: { $max: { $cond: [{ $eq: ["$isOld", 1] }, 0, 1] } },
        hasOld: { $max: { $cond: [{ $eq: ["$isOld", 1] }, 1, 0] } },
      },
    },
    {
      $group: {
        _id: { $substr: ["$_id.day", 0, 7] }, // YYYY-MM
        currentViews: { $sum: "$hasCurrent" },
        oldViews: { $sum: "$hasOld" },
        combinedViews: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];

  const results = await coll.aggregate(pipeline, { allowDiskUse: true }).toArray();
  const monthly = {};
  for (const r of results) {
    if (r._id) {
      monthly[r._id] = {
        current: Number(r.currentViews || 0),
        old: Number(r.oldViews || 0),
        combined: Number(r.combinedViews || 0),
      };
    }
  }
  return monthly;
}

/**
 * Proxy: prod_jobiak_ai.userAnalytics
 */
async function getProxyMonthly(employerId) {
  const coll = await mongo.col("prod_jobiak_ai", "userAnalytics");

  const pipeline = [
    { $match: { employerId, ...GOOGLE_VIEW_FILTER, createdDt: { $type: "date" } } },
    ...buildViewProjectionStage("createdDt"),
    {
      $group: {
        _id: { day: "$day", ip: "$ip", jobId: "$jobId" },
      },
    },
    {
      $group: {
        _id: { $substr: ["$_id.day", 0, 7] }, // YYYY-MM
        views: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];

  const results = await coll.aggregate(pipeline, { allowDiskUse: true }).toArray();
  const monthly = {};
  for (const r of results) {
    if (r._id) {
      monthly[r._id] = {
        current: Number(r.views || 0),
        old: 0,
        combined: Number(r.views || 0),
      };
    }
  }
  return monthly;
}

export async function runViewsReport(targetLead = "tarun", customSheetId = null) {
  const spreadsheetId = customSheetId || env.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error("Spreadsheet ID must be configured in .env (SPREADSHEET_ID) or passed via CLI.");
  }

  logger.section(`Monthly Views Report (Lead: ${targetLead})`);

  // 1. Read Domains dynamically from Google Sheet
  const rows = await googlesheet.read(spreadsheetId, `${INPUT_SHEET}!A2:D`);
  const domains = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;
    const [lead, domain, domainType, employerId] = row.map((v) => String(v || "").trim());

    if (!lead || !domain || !employerId) continue;
    if (targetLead === "all" || lead.toLowerCase() === targetLead.toLowerCase()) {
      domains.push({ lead, domain, domainType, employerId });
    }
  }

  logger.info(`Found ${domains.length} target domains`);
  if (domains.length === 0) return;

  // 2. Parallel execution with concurrency throttle
  const limit = pLimit(10);
  const monthlyData = [];

  const tasks = domains.map((item) =>
    limit(async () => {
      const isProxy = item.domainType.toLowerCase() === "proxy";
      try {
        const monthly = isProxy
          ? await getProxyMonthly(item.employerId)
          : await getDirectApplyMonthly(item.employerId);

        for (const [yearMonth, counts] of Object.entries(monthly)) {
          const [year, month] = yearMonth.split("-");
          monthlyData.push([
            item.lead,
            item.domain,
            item.domainType,
            item.employerId,
            parseInt(year, 10),
            parseInt(month, 10),
            yearMonth,
            counts.current,
            counts.old,
            counts.combined,
          ]);
        }
        logger.info(`Computed ${item.domain}`);
      } catch (err) {
        logger.error(`Error computing ${item.domain}`, err);
      }
    })
  );

  await Promise.all(tasks);

  // 3. Sort by domain and year-month
  monthlyData.sort((a, b) => a[1].localeCompare(b[1]) || a[6].localeCompare(b[6]));

  // 4. Output to Google Sheet
  const headers = [
    "Lead", "Domain", "Domain Type", "EmployerId", "Year", "Month",
    "Year-Month", "userAnalytics Views", "userAnalytics_old Views", "Combined Unique Views"
  ];

  const now = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";
  const output = [
    [`${targetLead.toUpperCase()} - MONTHLY UNIQUE VIEWS REPORT`],
    [`Generated: ${now}`],
    ["Rule: One unique click per UTC date + IP + Job ID."],
    ["Combined Unique Views deduplicates across both Direct Apply collections."],
    [],
    headers,
    ...monthlyData,
  ];

  logger.info(`Syncing ${monthlyData.length} records to sheet '${OUTPUT_SHEET}'...`);
  await googlesheet.clear(spreadsheetId, `${OUTPUT_SHEET}!A1:Z`);
  await googlesheet.write(spreadsheetId, `${OUTPUT_SHEET}!A1`, output);
  logger.success("Views report written to Google Sheet successfully");
}

if (process.argv[1]?.endsWith("views.js")) {
  const leadArg = process.argv[2] || "tarun";
  runViewsReport(leadArg)
    .then(async () => {
      await mongo.close();
      process.exit(0);
    })
    .catch(async (e) => {
      logger.error("Views report execution failed", e);
      await mongo.close();
      process.exit(1);
    });
}

export default runViewsReport;
