/**
 * gpd.js - Google Programmatic Distribution (GPD) Workflow Engine
 * =================================================================
 * Orchestrates the complete GPD lifecycle:
 * 1. ATS Ingestion Audit: Scans Target_P4_Opt in jobicarenode_prod.
 * 2. Description Hygiene: Identifies & sanitizes scrape artifacts (timestamps, stray dots, apply leaks).
 * 3. Schema.org/JobPosting Compliance: Scores jobs for Google for Jobs indexing readiness.
 * 4. Production Promotion & Drift: Reconciles staging against prod_jobiak_ai.job.
 */

import mongo from "../core/mongo.js";
import { loadClientsConfig } from "../core/auth.js";
import { cleanJobDescription, validateJobPostingSchema, RX_POSTED_PREFIX, RX_STRAY_DOT } from "../core/gfjSchema.js";
import logger from "../core/logger.js";

/**
 * 1. RUN GPD AUDIT ACROSS CLIENTS
 * Scans staging jobs for description defects and schema compliance.
 */
export async function runGpdAudit(options = {}) {
  logger.section("Google Programmatic Distribution (GPD) Quality Audit");

  const jobicareDb = await mongo.db("jobicarenode_prod");
  const p4Col = jobicareDb.collection("Target_P4_Opt");

  const clients = loadClientsConfig();
  const targetClient = options.client ? clients.filter((c) => c.name.toLowerCase().includes(options.client.toLowerCase())) : clients;

  if (targetClient.length === 0) {
    logger.warn(`No matching clients found for '${options.client || "all"}'`);
    return [];
  }

  const report = [];

  for (const client of targetClient) {
    logger.info(`Auditing GPD pipeline for ${client.name} (${client.jobicareEmployerId})...`);

    // Fetch active staging candidates
    const stagingJobs = await p4Col.find({
      employerId: client.jobicareEmployerId,
      job_status: { $ne: 3 },
    }, {
      projection: { _id: 1, title: 1, description: 1, city: 1, state: 1, job_status: 1 }
    }).limit(options.limit || 500).toArray();

    let timestampLeaks = 0;
    let strayDots = 0;
    let missingLocations = 0;
    let perfectSchemaCount = 0;

    for (const job of stagingJobs) {
      const desc = job.description || "";
      if (RX_POSTED_PREFIX.test(desc)) timestampLeaks++;
      if (RX_STRAY_DOT.test(desc)) strayDots++;
      if (!job.city || !job.state) missingLocations++;

      const schemaRes = validateJobPostingSchema({
        title: job.title,
        description: desc,
        datePosted: new Date(),
        company: client.name,
        city: job.city,
        state: job.state,
      });

      if (schemaRes.valid && schemaRes.score >= 90) perfectSchemaCount++;
    }

    const summary = {
      client: client.name,
      employerId: client.employerId,
      jobicareEmployerId: client.jobicareEmployerId,
      totalAudited: stagingJobs.length,
      timestampLeaks,
      strayDots,
      missingLocations,
      complianceRate: stagingJobs.length > 0 ? ((perfectSchemaCount / stagingJobs.length) * 100).toFixed(1) + "%" : "100%",
      status: (timestampLeaks > 0 || strayDots > 0) ? "ACTION_REQUIRED" : "READY_FOR_GOOGLE",
    };

    report.push(summary);
    logger.info(`GPD [${client.name}]: ${stagingJobs.length} audited | Leaks: ${timestampLeaks} | Dots: ${strayDots} | Compliance: ${summary.complianceRate}`);
  }

  logger.success("GPD Quality Audit completed");
  return report;
}

/**
 * 2. SANITIZE & FIX GPD DESCRIPTIONS IN STAGING
 * Directly sanitizes dirty descriptions in Target_P4_Opt.
 */
export async function runGpdClean(options = {}) {
  logger.section("GPD Description Sanitizer & Fixer");

  const jobicareDb = await mongo.db("jobicarenode_prod");
  const p4Col = jobicareDb.collection("Target_P4_Opt");

  const clients = loadClientsConfig();
  const targetClient = options.client ? clients.filter((c) => c.name.toLowerCase().includes(options.client.toLowerCase())) : clients;

  let totalCleaned = 0;

  for (const client of targetClient) {
    logger.info(`Scanning and cleaning descriptions for ${client.name}...`);

    const dirtyJobs = await p4Col.find({
      employerId: client.jobicareEmployerId,
      job_status: { $ne: 3 },
      $or: [
        { description: { $regex: RX_POSTED_PREFIX } },
        { description: { $regex: RX_STRAY_DOT } },
      ],
    }).toArray();

    if (dirtyJobs.length === 0) {
      logger.success(`  ✓ ${client.name} has zero dirty descriptions`);
      continue;
    }

    logger.warn(`  Found ${dirtyJobs.length} dirty descriptions for ${client.name}. Cleaning...`);

    for (const job of dirtyJobs) {
      const cleaned = cleanJobDescription(job.description);
      if (options.commit) {
        await p4Col.updateOne({ _id: job._id }, { $set: { description: cleaned, updatedAt: new Date() } });
      }
      totalCleaned++;
    }

    logger.info(`  Cleaned ${dirtyJobs.length} jobs for ${client.name} (${options.commit ? "COMMITTED" : "DRY RUN"})`);
  }

  logger.success(`GPD Clean completed: ${totalCleaned} total listings sanitized`);
  return { totalCleaned, committed: options.commit === true };
}
