/**
 * apply_yes_fixes.js - Database Sanitizer for YES! Communities
 * ============================================================
 * Reads generated fixes from yes_communities_all_fixed_jobs.json
 * and applies clean descriptions and formatted salary fields
 * to prod_jobiak_ai.job.
 * 
 * Usage:
 *   node scripts/apply_yes_fixes.js              # Dry Run
 *   node scripts/apply_yes_fixes.js --commit     # Commit to MongoDB
 *   node scripts/apply_yes_fixes.js --active-only --commit # Only update active jobs
 */

import fs from "fs";
import path from "path";
import mongo from "../core/mongo.js";
import logger from "../core/logger.js";

async function applyFixes() {
  const isCommit = process.argv.includes("--commit");
  const activeOnly = process.argv.includes("--active-only");

  logger.section(`YES! Communities Description Sanitizer (${isCommit ? "COMMIT MODE" : "DRY RUN"})`);

  const dataPath = path.resolve("./scripts/yes_communities_all_fixed_jobs.json");
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Data file not found: ${dataPath}. Run process_and_export_all.js first.`);
  }

  const jobsToFix = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const candidates = activeOnly ? jobsToFix.filter(j => j.status === "posted" && j.isActive) : jobsToFix;

  logger.info(`Loaded ${candidates.length} candidate jobs to update (Active only: ${activeOnly})`);

  const db = await mongo.db("prod_jobiak_ai");
  const jobCol = db.collection("job");

  let updatedCount = 0;

  for (const item of candidates) {
    const updateDoc = {};

    if (item.description.modified !== item.description.original) {
      updateDoc.description = item.description.modified;
    }

    if (item.salary.modified !== item.salary.original && item.salary.modified !== null) {
      updateDoc.salary = item.salary.modified;
    }

    if (Object.keys(updateDoc).length > 0) {
      updateDoc.updatedAt = new Date();

      if (isCommit) {
        await jobCol.updateOne(
          { jobId: item.jobId },
          { $set: updateDoc }
        );
      }
      updatedCount++;
    }
  }

  if (isCommit) {
    logger.success(`Committed updates to ${updatedCount} jobs in prod_jobiak_ai.job`);
  } else {
    logger.warn(`DRY RUN complete: ${updatedCount} jobs would be updated. Run with --commit to persist changes.`);
  }

  await mongo.close();
}

applyFixes().catch((err) => {
  logger.error("Failed to apply fixes", err);
  process.exit(1);
});
