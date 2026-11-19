/**
 * expires.js - Zero-Click Job Expiry Reconciliation Engine
 * ========================================================
 * Replaces: expires.py
 * 
 * Identifies posted jobs on prod_jobiak_ai with zero Google search views and
 * cross-checks feed status to generate safe expiry candidates.
 */

import mongo from "../core/mongo.js";
import googlesheet from "../core/googlesheet.js";
import { env, loadClientsConfig } from "../core/auth.js";
import { GOOGLE_VIEW_FILTER } from "../core/query.js";
import logger from "../core/logger.js";

const OUTPUT_SHEET = "Expires";

export async function runExpires(customSheetId = null) {
  const spreadsheetId = customSheetId || env.expiresSpreadsheetId;
  if (!spreadsheetId) {
    throw new Error("EXPIRES_SPREADSHEET_ID or SPREADSHEET_ID must be configured in .env");
  }

  logger.section("Zero-Click Job Expiry Audit");

  const jobCol = await mongo.col("prod_jobiak_ai", "job");
  const analyticsCol = await mongo.col("prod_jobiak_ai", "userAnalytics");

  let clients = loadClientsConfig();
  if (!clients || clients.length === 0) {
    logger.info("Reading clients dynamically from Domains worksheet...");
    const rows = await googlesheet.read(spreadsheetId, "Domains!A2:E");
    clients = rows
      .filter((r) => r && r[2]?.toLowerCase() === "proxy" && r[3])
      .map((r) => ({
        name: r[0],
        domain: r[1],
        type: r[2],
        employerId: r[3],
        jobicareEmployerId: r[4] || `emp-jicn-${r[0].toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      }));
  }

  logger.info(`Evaluating zero-click candidates across ${clients.length} Proxy clients`);
  const expiryCandidates = [];
  const checkedAt = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";

  for (const client of clients) {
    logger.info(`Checking posted jobs for ${client.name}...`);

    const cursor = jobCol
      .find(
        { employerId: client.employerId, status: "posted", isActive: true },
        { projection: { jobId: 1, title: 1, status: 1, isActive: 1, datePosted: 1 } }
      )
      .batchSize(500);

    let batch = [];
    while (await cursor.hasNext()) {
      batch.push(await cursor.next());
      if (batch.length >= 500) {
        await evaluateBatch(batch, client, analyticsCol, expiryCandidates, checkedAt);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await evaluateBatch(batch, client, analyticsCol, expiryCandidates, checkedAt);
    }
  }

  logger.success(`Zero-click evaluation complete. Found ${expiryCandidates.length} candidates`);

  const headers = [
    "Client", "EmployerId", "Jobicare EmployerId", "Job ID", "Job Title",
    "Status", "Is Active", "Date Posted", "Job Views", "Checked At"
  ];

  if (expiryCandidates.length > 0) {
    try {
      await googlesheet.clear(spreadsheetId, `${OUTPUT_SHEET}!A1:Z`);
      await googlesheet.write(spreadsheetId, `${OUTPUT_SHEET}!A1`, [headers, ...expiryCandidates]);
      logger.success(`Published ${expiryCandidates.length} candidate rows to '${OUTPUT_SHEET}'`);
    } catch (err) {
      logger.warn(`Could not sync to Google Sheet (${err.message}). Data maintained in memory.`);
    }
  }

  return expiryCandidates;
}

async function evaluateBatch(jobs, client, analyticsCol, expiryCandidates, checkedAt) {
  const jobIds = jobs.map((j) => j.jobId).filter(Boolean);

  const views = await analyticsCol
    .aggregate([
      { $match: { employerId: client.employerId, ...GOOGLE_VIEW_FILTER, childJobId: { $in: jobIds } } },
      { $group: { _id: "$childJobId", count: { $sum: 1 } } },
    ])
    .toArray();

  const viewMap = new Map(views.map((v) => [v._id, v.count]));

  for (const job of jobs) {
    const jobViews = viewMap.get(job.jobId) || 0;
    if (jobViews === 0) {
      expiryCandidates.push([
        client.name,
        client.employerId,
        client.jobicareEmployerId || "",
        job.jobId,
        job.title || "",
        job.status || "posted",
        job.isActive ? "TRUE" : "FALSE",
        job.datePosted ? new Date(job.datePosted).toISOString().split("T")[0] : "",
        0,
        checkedAt,
      ]);
    }
  }
}

if (process.argv[1]?.endsWith("expires.js")) {
  runExpires()
    .then(async () => {
      await mongo.close();
      process.exit(0);
    })
    .catch(async (e) => {
      logger.error("Expires execution failed", e);
      await mongo.close();
      process.exit(1);
    });
}

export default runExpires;
