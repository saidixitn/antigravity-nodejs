/**
 * aliasMap.js - Multi-Alias Analytics Resolver
 * ============================================
 * Solves: The 35% Analytics Join Loss Problem.
 * 
 * In prod_jobiak_ai.userAnalytics, click and view events can log:
 * - childJobId
 * - jobId
 * - jobPubJobId
 * - clientJobId (which matches uniqueKey)
 * 
 * If an analytics join strictly matches on 'jobId', up to 35% of valid
 * Google for Jobs views are lost!
 * 
 * This resolver constructs an in-memory bi-directional alias map across
 * all identifier fields in prod_jobiak_ai.job.
 */

import mongo from "./mongo.js";
import logger from "./logger.js";

export class AliasResolver {
  constructor(employerId) {
    this.employerId = employerId;
    this.aliasToCanonical = new Map();
    this.canonicalToDetails = new Map();
  }

  /**
   * Builds the in-memory multi-alias lookup index for a given employer
   */
  async buildIndex() {
    logger.info(`Building Multi-Alias Resolver Index for employerId: ${this.employerId}...`);
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");

    const cursor = jobCol.find(
      { employerId: this.employerId },
      {
        projection: {
          jobId: 1,
          clientJobId: 1,
          jobPubJobId: 1,
          title: 1,
          location: 1,
          city: 1,
          state: 1,
          status: 1,
          isActive: 1,
        },
      }
    );

    let count = 0;
    for await (const doc of cursor) {
      const canonicalId = String(doc.jobId || doc._id);

      this.canonicalToDetails.set(canonicalId, {
        jobId: canonicalId,
        clientJobId: doc.clientJobId,
        jobPubJobId: doc.jobPubJobId,
        title: doc.title,
        location: doc.location || `${doc.city || ""}, ${doc.state || ""}`,
        status: doc.status,
        isActive: doc.isActive,
      });

      // Map all available aliases to canonical ID
      this.aliasToCanonical.set(canonicalId, canonicalId);
      if (doc._id) this.aliasToCanonical.set(String(doc._id), canonicalId);
      if (doc.clientJobId) this.aliasToCanonical.set(String(doc.clientJobId), canonicalId);
      if (doc.jobPubJobId) this.aliasToCanonical.set(String(doc.jobPubJobId), canonicalId);

      count++;
    }

    logger.success(`Indexed ${count} jobs -> ${this.aliasToCanonical.size} alias pointers created`);
    return count;
  }

  /**
   * Resolves any incoming raw identifier (childJobId, clientJobId, jobPubJobId)
   * to its canonical jobId
   */
  resolve(anyId) {
    if (!anyId) return null;
    return this.aliasToCanonical.get(String(anyId)) || null;
  }

  /**
   * Retrieves full job details for any alias
   */
  getJob(anyId) {
    const canonical = this.resolve(anyId);
    if (!canonical) return null;
    return this.canonicalToDetails.get(canonical) || null;
  }
}

/**
 * Factory helper
 */
export async function createAliasResolver(employerId) {
  const resolver = new AliasResolver(employerId);
  await resolver.buildIndex();
  return resolver;
}
