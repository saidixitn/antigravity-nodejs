/**
 * collision.js - Pre-Posting Collision Detection & Ingestion Gate
 * ==============================================================
 * Solves: JobiCare Staging (jobicarenode_prod.Target_P4_Opt) vs
 *         Proxy Production (prod_jobiak_ai.job) Pre-Posting Ingestion Collision.
 * 
 * CORE RULE:
 * If a candidate uniqueKey from Target_P4_Opt is ALREADY present in prod_jobiak_ai.job
 * under clientJobId, WE CANNOT POST!
 * Posting duplicates causes Google for Jobs URL collision and index dilution.
 * 
 * Key Mapping:
 *   jobicarenode_prod.Target_P4_Opt.uniqueKey <---> prod_jobiak_ai.job.clientJobId
 */

import pLimit from "p-limit";
import mongo from "../core/mongo.js";
import { loadClientsConfig } from "../core/auth.js";
import logger from "../core/logger.js";

/**
 * Audit candidate uniqueKeys in staging against live production
 */
export async function runCollisionCheck(clientName = null, options = {}) {
  logger.section("Pre-Posting Ingestion Collision Check");

  const clients = loadClientsConfig();
  const targets = clientName
    ? clients.filter((c) => c.name.toLowerCase().includes(clientName.toLowerCase()))
    : clients;

  if (targets.length === 0) {
    logger.warn(`No matching clients found for '${clientName || "all"}'`);
    return [];
  }

  const jobicareDb = await mongo.db("jobicarenode_prod");
  const p4Col = jobicareDb.collection("Target_P4_Opt");

  const prodDb = await mongo.db("prod_jobiak_ai");
  const jobCol = prodDb.collection("job");

  const collisionReport = [];

  for (const client of targets) {
    logger.info(`Checking ingestion collision for ${client.name}...`);

    // 1. Fetch candidate uniqueKeys from staging (job_status != 3, candidate gpost)
    const stagingCandidates = await p4Col.find(
      {
        employerId: client.jobicareEmployerId,
        job_status: { $ne: 3 },
      },
      { projection: { uniqueKey: 1, jobtitle: 1, title: 1, uncleanedLocation: 1, city: 1, state: 1 } }
    ).limit(options.limit || 5000).toArray();

    const candidateKeys = stagingCandidates.map((j) => j.uniqueKey).filter(Boolean);
    const uniqueCandidateKeys = [...new Set(candidateKeys)];

    if (uniqueCandidateKeys.length === 0) {
      logger.info(`  ${client.name}: No active candidate uniqueKeys in staging`);
      collisionReport.push({
        client: client.name,
        stagingCandidates: 0,
        alreadyInProduction: 0,
        availableToPost: 0,
        collisionRate: "0%",
        status: "EMPTY_STAGING",
      });
      continue;
    }

    // 2. Query production jobs in batches of 500 for matching clientJobId
    const limit = pLimit(5);
    const BATCH_SIZE = 500;
    const batches = [];

    for (let i = 0; i < uniqueCandidateKeys.length; i += BATCH_SIZE) {
      batches.push(uniqueCandidateKeys.slice(i, i + BATCH_SIZE));
    }

    let existingInProdCount = 0;
    let livePostedCount = 0;
    let removedCount = 0;

    const prodQueries = batches.map((batch) =>
      limit(async () => {
        const prodDocs = await jobCol.find(
          {
            employerId: client.employerId,
            clientJobId: { $in: batch },
          },
          { projection: { clientJobId: 1, status: 1, isActive: 1 } }
        ).toArray();

        for (const doc of prodDocs) {
          existingInProdCount++;
          if (doc.status === "posted" && doc.isActive === true) {
            livePostedCount++;
          } else {
            removedCount++;
          }
        }
      })
    );

    await Promise.all(prodQueries);

    const availableToPost = uniqueCandidateKeys.length - existingInProdCount;
    const collisionRate = ((existingInProdCount / uniqueCandidateKeys.length) * 100).toFixed(1) + "%";

    const summary = {
      client: client.name,
      employerId: client.employerId,
      jobicareEmployerId: client.jobicareEmployerId,
      stagingCandidates: uniqueCandidateKeys.length,
      alreadyInProduction: existingInProdCount,
      livePosted: livePostedCount,
      previouslyRemoved: removedCount,
      availableToPost,
      collisionRate,
      status: availableToPost > 0 ? "SAFE_TO_POST_PARTIAL" : "ALL_KEYS_COLLIDE",
    };

    collisionReport.push(summary);
    logger.info(`  ${client.name}: ${availableToPost} Available to Post | ${existingInProdCount} Collision (${collisionRate})`);
  }

  logger.success("Pre-Posting Collision Check completed");
  return collisionReport;
}
