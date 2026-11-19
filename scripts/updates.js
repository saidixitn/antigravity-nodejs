/**
 * updates.js - Proxy Sliding Window Job Updates
 * =============================================
 * Replaces: updates.py
 * 
 * Reconciles active posted jobs in prod_jobiak_ai against staging jobicarenode_prod,
 * evaluates Google search view performance, and identifies update candidates.
 */

import mongo from "../core/mongo.js";
import googlesheet from "../core/googlesheet.js";
import { env, loadClientsConfig } from "../core/auth.js";
import { GOOGLE_VIEW_FILTER } from "../core/query.js";
import logger from "../core/logger.js";

const OUTPUT_SHEET = "Updates";

export async function runUpdates(customSheetId = null) {
  const spreadsheetId = customSheetId || env.updatesSpreadsheetId;
  if (!spreadsheetId) {
    throw new Error("UPDATES_SPREADSHEET_ID or SPREADSHEET_ID must be configured in .env");
  }

  logger.section("Proxy Sliding Window Updates");

  const jobCol = await mongo.col("prod_jobiak_ai", "job");
  const analyticsCol = await mongo.col("prod_jobiak_ai", "userAnalytics");
  const p4Col = await mongo.col("jobicarenode_prod", "Target_P4_Opt");

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

  logger.info(`Loaded ${clients.length} Proxy clients for updates evaluation`);
  const updateRows = [];
  const checkedAt = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";

  for (const client of clients) {
    logger.info(`Scanning active jobs for ${client.name}...`);

    const cursor = jobCol
      .find(
        { employerId: client.employerId, status: "posted", isActive: true },
        { projection: { jobId: 1, clientJobId: 1, title: 1, location: 1, datePosted: 1, validThrough: 1, pageUrl: 1 } }
      )
      .batchSize(500);

    let batch = [];
    while (await cursor.hasNext()) {
      batch.push(await cursor.next());
      if (batch.length >= 500) {
        await processBatch(batch, client, p4Col, analyticsCol, updateRows, checkedAt);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await processBatch(batch, client, p4Col, analyticsCol, updateRows, checkedAt);
    }
  }

  logger.success(`Evaluated updates. Found ${updateRows.length} candidates`);

  // Write to Google Sheet
  const headers = [
    "Client", "EmployerId", "Jobicare EmployerId", "Job ID", "Client Job ID",
    "Job Title", "Location", "URL", "Date Posted", "Valid Through", "Job Views", "Checked At"
  ];

  if (updateRows.length > 0) {
    try {
      await googlesheet.clear(spreadsheetId, `${OUTPUT_SHEET}!A1:Z`);
      await googlesheet.write(spreadsheetId, `${OUTPUT_SHEET}!A1`, [headers, ...updateRows]);
      logger.success(`Published ${updateRows.length} rows to sheet tab '${OUTPUT_SHEET}'`);
    } catch (err) {
      logger.warn(`Could not sync to Google Sheet (${err.message}). Data maintained in memory.`);
    }
  }

  return updateRows;
}

async function processBatch(jobs, client, p4Col, analyticsCol, updateRows, checkedAt) {
  const clientJobIds = jobs.map((j) => j.clientJobId).filter(Boolean);
  const jobIds = jobs.map((j) => j.jobId).filter(Boolean);

  // Cross-reference valid staging status (job_status != 3)
  const stagingDocs = await p4Col
    .find(
      { employerId: client.jobicareEmployerId, uniquekey: { $in: clientJobIds }, job_status: { $ne: 3 } },
      { projection: { uniquekey: 1 } }
    )
    .toArray();
  const validKeys = new Set(stagingDocs.map((d) => d.uniquekey));

  // Get view counts
  const views = await analyticsCol
    .aggregate([
      { $match: { employerId: client.employerId, ...GOOGLE_VIEW_FILTER, childJobId: { $in: jobIds } } },
      { $group: { _id: "$childJobId", count: { $sum: 1 } } },
    ])
    .toArray();
  const viewMap = new Map(views.map((v) => [v._id, v.count]));

  for (const job of jobs) {
    if (job.clientJobId && validKeys.has(job.clientJobId)) {
      updateRows.push([
        client.name,
        client.employerId,
        client.jobicareEmployerId,
        job.jobId,
        job.clientJobId,
        job.title || "",
        typeof job.location === "object" ? JSON.stringify(job.location) : String(job.location || ""),
        job.pageUrl || "",
        job.datePosted ? new Date(job.datePosted).toISOString().split("T")[0] : "",
        job.validThrough ? new Date(job.validThrough).toISOString().split("T")[0] : "",
        viewMap.get(job.jobId) || 0,
        checkedAt,
      ]);
    }
  }
}

if (process.argv[1]?.endsWith("updates.js")) {
  runUpdates()
    .then(async () => {
      await mongo.close();
      process.exit(0);
    })
    .catch(async (e) => {
      logger.error("Updates execution failed", e);
      await mongo.close();
      process.exit(1);
    });
}

export default runUpdates;
