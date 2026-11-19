/**
 * gxc.js - GXC Feed Intelligence & Cross-Feed Analyzer
 * =====================================================
 * Replaces: antigravity/compare_emp_gxc_feeds.py, antigravity/check_genxml.py
 * 
 * Multiplexes across all 396+ 'emp-gxc-*' collections in generateXml_prod.
 * Scans for target employers (DoorDash, Uber, Gopuff, Albertsons, Grubhub),
 * extracts CPA/CPC rate distributions, and provides cross-feed intelligence.
 */

import pLimit from "p-limit";
import mongo from "../core/mongo.js";
import logger from "../core/logger.js";

// Company name normalizer
export function normalizeCompany(raw) {
  const low = String(raw || "").toLowerCase();
  if (low.includes("albertsons")) return "Albertsons";
  if (low.includes("gopuff")) return "Gopuff";
  if (low.includes("doordash")) return "DoorDash";
  if (low.includes("grubhub")) return "Grubhub";
  if (low.includes("ubereats") || low.includes("uber eats")) return "Uber Eats";
  if (low.includes("uber")) return "Uber";
  return raw ? raw.trim() : "Unknown";
}

// Clean float parser for monetary values
export function safeFloat(val) {
  if (val === null || val === undefined || val === "") return null;
  try {
    const clean = String(val).replace("$", "").trim();
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

/**
 * 1. LIST ALL GXC FEED COLLECTIONS
 */
export async function listGxcCollections() {
  logger.section("Listing GXC Collections in generateXml_prod");

  const db = await mongo.db("generateXml_prod");
  const allCols = await db.listCollections().toArray();
  const gxcCols = allCols
    .map((c) => c.name)
    .filter((name) => name.startsWith("emp-gxc-"))
    .sort();

  logger.info(`Found ${gxcCols.length} 'emp-gxc-*' syndication collections`);
  return gxcCols;
}

/**
 * 2. SCAN & COMPARE FEEDS ACROSS GXC COLLECTIONS
 */
export async function runGxcCompare(options = {}) {
  const targetFilter = options.company || "albertsons|gopuff|doordash|uber|grubhub";
  const regex = new RegExp(targetFilter, "i");

  logger.section(`GXC Cross-Feed Intelligence (Matching: ${targetFilter})`);

  const db = await mongo.db("generateXml_prod");
  const collections = await listGxcCollections();

  if (collections.length === 0) {
    logger.warn("No 'emp-gxc-*' collections found in generateXml_prod");
    return [];
  }

  // Scan collections with concurrency limit
  const limit = pLimit(options.concurrency || 15);
  const matchedFeeds = [];

  const tasks = collections.map((colName) =>
    limit(async () => {
      try {
        const col = db.collection(colName);
        const docs = await col
          .find({ company: { $regex: regex } }, { projection: { _id: 0, company: 1, title: 1, cpa: 1, cpc: 1 } })
          .limit(options.limitPerFeed || 2000)
          .toArray();

        if (docs.length > 0) {
          const groupMap = {};

          for (const doc of docs) {
            const comp = normalizeCompany(doc.company);
            const title = String(doc.title || "").trim();
            const key = `${comp}:::${title}`;

            if (!groupMap[key]) {
              groupMap[key] = {
                company: comp,
                title,
                count: 0,
                cpas: [],
                cpcs: [],
              };
            }

            groupMap[key].count++;
            const cpaNum = safeFloat(doc.cpa);
            if (cpaNum !== null) groupMap[key].cpas.push(cpaNum);
            const cpcNum = safeFloat(doc.cpc);
            if (cpcNum !== null) groupMap[key].cpcs.push(cpcNum);
          }

          matchedFeeds.push({
            collection: colName,
            totalMatches: docs.length,
            groups: Object.values(groupMap),
          });

          logger.info(`  ✓ Match in ${colName}: ${docs.length} jobs across ${Object.keys(groupMap).length} title groups`);
        }
      } catch (err) {
        logger.error(`Error scanning ${colName}: ${err.message}`);
      }
    })
  );

  await Promise.all(tasks);

  // Flatten into analysis summary
  const summaryRows = [];
  for (const feed of matchedFeeds) {
    for (const grp of feed.groups) {
      const avgCpa = grp.cpas.length ? (grp.cpas.reduce((a, b) => a + b, 0) / grp.cpas.length).toFixed(2) : "N/A";
      const avgCpc = grp.cpcs.length ? (grp.cpcs.reduce((a, b) => a + b, 0) / grp.cpcs.length).toFixed(2) : "N/A";

      summaryRows.push({
        company: grp.company,
        title: grp.title,
        collection: feed.collection,
        jobCount: grp.count,
        avgCpa,
        avgCpc,
      });
    }
  }

  logger.success(`GXC Comparison Complete: Found ${summaryRows.length} title-level matches across ${matchedFeeds.length} active feeds`);

  return {
    filter: targetFilter,
    feedsScanned: collections.length,
    matchedFeedsCount: matchedFeeds.length,
    totalTitlesFound: summaryRows.length,
    results: summaryRows.slice(0, 500), // Return top 500 for API/CLI inspection
  };
}
