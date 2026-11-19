/**
 * keywords.js - Keywords Generation & Dynamic Location Expansion Engine
 * =======================================================================
 * Replaces: generate_lettuce_keywords.py, check_google_drive_keywords.py, postings.py
 * 
 * Generates and validates Google for Jobs search keywords:
 * 1. Schema 1 (14 Columns): Generic, TitleToTitle, and Company Keywords
 * 2. Schema 2 (10 Columns): Location Keywords (expands templates like "{title} jobs in {city}, {state}")
 * 3. Enforces strict lowercase title rules ("cook", "dietary aide", "housekeeper")
 */

import mongo from "../core/mongo.js";
import { loadClientsConfig } from "../core/auth.js";
import logger from "../core/logger.js";

/**
 * Validates keyword titles (MUST be lowercase in Jobiak collections)
 */
export function validateKeywordTitle(title) {
  if (!title) return { valid: false, error: "Title is empty" };
  const trimmed = String(title).trim();
  const isLower = trimmed === trimmed.toLowerCase();
  return {
    valid: isLower,
    original: trimmed,
    normalized: trimmed.toLowerCase(),
    error: isLower ? null : `Title '${trimmed}' must be lowercase: '${trimmed.toLowerCase()}'`,
  };
}

/**
 * Expands location keywords templates across a client's active jobs catalog
 */
export async function expandLocationKeywords(clientName = "HCSG", options = {}) {
  logger.section(`Location Keywords Expansion: ${clientName}`);

  const clients = loadClientsConfig();
  const client = clients.find((c) => c.name.toLowerCase().includes(clientName.toLowerCase()));
  if (!client) {
    throw new Error(`Client '${clientName}' not found in clients.json`);
  }

  const prodDb = await mongo.db("prod_jobiak_ai");
  const jobCol = prodDb.collection("job");

  logger.info(`Fetching distinct active locations and titles for ${client.name}...`);

  const distinctJobs = await jobCol
    .find(
      { employerId: client.employerId, status: "posted", isActive: true },
      { projection: { title: 1, city: 1, state: 1, location: 1, company: 1 } }
    )
    .limit(options.limit || 500)
    .toArray();

  const expandedKeywords = [];
  const createdAt = new Date().toISOString();

  for (const job of distinctJobs) {
    let city = job.city;
    let state = job.state;
    if ((!city || !state) && job.location) {
      const parts = String(job.location).split(",");
      if (parts.length >= 2) {
        city = parts[0].trim();
        state = parts[1].trim();
      }
    }
    if (!city || !state || !job.title) continue;

    const normTitle = String(job.title).trim().toLowerCase();
    const cleanCity = city.trim();
    const cleanState = state.trim().toUpperCase();
    const company = job.company || client.name;

    // Standard high-converting Google for Jobs search templates
    const templates = [
      `${normTitle} jobs in ${cleanCity}, ${cleanState}`,
      `${normTitle} jobs near ${cleanCity}, ${cleanState}`,
      `${normTitle} hiring near me`,
      `${cleanCity} ${normTitle} careers`,
    ];

    for (const kw of templates) {
      // 10-column location keyword schema
      expandedKeywords.push({
        employerId: client.employerId,
        confidenceValue: 1.0,
        keyword: kw,
        keywordType: "location",
        operatorType: "contains-title",
        title: normTitle, // STRICT LOWERCASE
        isActive: true,
        companyName: company,
        createdAt,
        city,
        state,
      });
    }
  }

  logger.success(`Generated ${expandedKeywords.length} location keywords across ${distinctJobs.length} active listings`);

  return {
    client: client.name,
    employerId: client.employerId,
    sampleJobsUsed: distinctJobs.length,
    totalKeywordsGenerated: expandedKeywords.length,
    sampleOutput: expandedKeywords.slice(0, 20),
  };
}
