/**
 * dedup.js - Duplicate Job Clustering & Keyword Cannibalization Prevention
 * =========================================================================
 * Replaces: concentrix_expires.py
 * 
 * Prevents keyword cannibalization and wasted Google crawl budget when a Proxy
 * employer has multiple active postings for the same role in the exact same city.
 * 
 * Decision Logic:
 * 1. Groups live posted jobs by exact location (city + state).
 * 2. Compares titles within the same location.
 * 3. Compares Google views across duplicates:
 *    - Highest performing job: KEEP (Active)
 *    - Duplicate listings with fewer views: EXPIRE
 *    - All zero views: FLAG_REVIEW
 */

import mongo from "../core/mongo.js";
import { loadClientsConfig } from "../core/auth.js";
import { createAliasResolver } from "../core/aliasMap.js";
import logger from "../core/logger.js";

// Normalize title for similarity comparison
export function cleanTitleForMatch(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Run duplicate clustering and retention evaluation for a client
 */
export async function runDuplicateAudit(clientName = "Concentrix", options = {}) {
  logger.section(`Duplicate Job Clustering & Cannibalization Audit: ${clientName}`);

  const clients = loadClientsConfig();
  const client = clients.find((c) => c.name.toLowerCase().includes(clientName.toLowerCase()));
  if (!client) {
    throw new Error(`Client '${clientName}' not found in clients.json`);
  }

  const prodDb = await mongo.db("prod_jobiak_ai");
  const jobCol = prodDb.collection("job");
  const analyticsCol = prodDb.collection("userAnalytics");

  // 1. Fetch active posted jobs
  logger.info(`Fetching live posted jobs for ${client.name} (${client.employerId})...`);
  const jobs = await jobCol
    .find(
      {
        employerId: client.employerId,
        status: "posted",
        isActive: true,
      },
      {
        projection: {
          jobId: 1,
          title: 1,
          city: 1,
          state: 1,
          location: 1,
          clientJobId: 1,
          datePosted: 1,
        },
      }
    )
    .limit(options.limit || 5000)
    .toArray();

  logger.info(`Fetched ${jobs.length} active jobs. Bucketing by location...`);

  // 2. Bucket by normalized location
  const locationBuckets = new Map();
  for (const job of jobs) {
    let city = job.city;
    let state = job.state;
    if ((!city || !state) && job.location) {
      const parts = String(job.location).split(",");
      if (parts.length >= 2) {
        city = parts[0].trim();
        state = parts[1].trim();
      }
    }
    const loc = `${String(city || "").trim().toLowerCase()}~~${String(state || "").trim().toLowerCase()}`;
    if (!loc || loc === "~~~~") continue;

    if (!locationBuckets.has(loc)) {
      locationBuckets.set(loc, []);
    }
    locationBuckets.get(loc).push(job);
  }

  // 3. Find duplicate candidates within each location
  const duplicateGroups = [];
  let clusterId = 1;

  for (const [loc, locJobs] of locationBuckets.entries()) {
    if (locJobs.length < 2) continue;

    const titleGroups = new Map();
    for (const job of locJobs) {
      const normTitle = cleanTitleForMatch(job.title);
      if (!titleGroups.has(normTitle)) {
        titleGroups.set(normTitle, []);
      }
      titleGroups.get(normTitle).push(job);
    }

    for (const [normTitle, dupes] of titleGroups.entries()) {
      if (dupes.length > 1) {
        duplicateGroups.push({
          clusterId: `DUP-${String(clusterId++).padStart(4, "0")}`,
          location: loc.replace("~~", ", ").toUpperCase(),
          normalizedTitle: normTitle,
          jobCount: dupes.length,
          jobs: dupes,
        });
      }
    }
  }

  logger.info(`Found ${duplicateGroups.length} duplicate job clusters spanning multiple active listings`);

  if (duplicateGroups.length === 0) {
    logger.success("No duplicate job collisions found for this client");
    return {
      client: client.name,
      employerId: client.employerId,
      totalClustersFound: 0,
      evaluatedRecords: 0,
      keepCount: 0,
      expireCount: 0,
      recommendations: [],
    };
  }

  // 4. Resolve views for each duplicate job to make retention decision
  const resolver = await createAliasResolver(client.employerId);
  const recommendations = [];

  for (const group of duplicateGroups.slice(0, 50)) {
    const scoredJobs = [];

    for (const j of group.jobs) {
      const jobId = String(j.jobId || j._id);
      // Query pure human views from userAnalytics
      const viewCount = await analyticsCol
        .countDocuments({
          employerId: client.employerId,
          $or: [{ jobId }, { childJobId: jobId }],
          isBot: false,
          isFromGoogle: true,
        })
        .catch(() => 0);

      scoredJobs.push({
        jobId,
        title: j.title,
        clientJobId: j.clientJobId,
        views: viewCount,
      });
    }

    // Sort by views descending
    scoredJobs.sort((a, b) => b.views - a.views);

    // Winner is index 0
    const winner = scoredJobs[0];
    const isTieOrZero = scoredJobs.every((sj) => sj.views === 0);

    for (let i = 0; i < scoredJobs.length; i++) {
      const sj = scoredJobs[i];
      let action = "REVIEW";
      let reason = "Tied on views";

      if (!isTieOrZero) {
        if (i === 0) {
          action = "KEEP";
          reason = `Winner with highest Google views (${sj.views})`;
        } else {
          action = "EXPIRE";
          reason = `Duplicate cannibalizing winner (lower views: ${sj.views} vs ${winner.views})`;
        }
      } else {
        action = i === 0 ? "KEEP" : "EXPIRE_CRAWL_SAVE";
        reason = "Zero views on all duplicates; keeping primary, retiring clones";
      }

      recommendations.push({
        clusterId: group.clusterId,
        location: group.location,
        jobId: sj.jobId,
        title: sj.title,
        views: sj.views,
        action,
        reason,
      });
    }
  }

  const keepCount = recommendations.filter((r) => r.action === "KEEP").length;
  const expireCount = recommendations.filter((r) => r.action.startsWith("EXPIRE")).length;

  logger.success(`Duplicate Audit Complete: Evaluated ${recommendations.length} duplicate jobs (${keepCount} Keep / ${expireCount} Expire candidates)`);

  return {
    client: client.name,
    employerId: client.employerId,
    totalClustersFound: duplicateGroups.length,
    evaluatedRecords: recommendations.length,
    keepCount,
    expireCount,
    recommendations: recommendations.slice(0, 100),
  };
}
