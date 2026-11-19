/**
 * gfjSchema.js - Google for Jobs (GFJ) Schema & Description Hygiene Engine
 * =========================================================================
 * Enforces strict Google for Jobs schema validation, ATS description sanitation,
 * and JSON-LD JobPosting structured data standards.
 * 
 * Rules Implemented:
 * 1. Description Cleaning (Strips scrape timestamps, stray dots, trailing address text, apply leaks)
 * 2. Schema.org/JobPosting Validation (Required & recommended Google properties)
 * 3. BaseSalary MonetaryAmount formatting
 * 4. JobLocation PostalAddress formatting
 * 5. Keyword title lowercase enforcement
 */

// Production Regex Patterns for ATS scrape artifact cleaning
export const RX_POSTED_PREFIX = /^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\s*/i;
export const RX_STRAY_DOT = /^\s*<p><strong>\s*\.\s*<\/strong><\/p>\s*/i;
export const RX_APPLY_LEAKS = [
  /visit\s+[a-z0-9.-]+\/careers\/?\s+directly(?:\s+for\s+confirmed\s+position\s+openings)?\.?/gi,
  /https?:\/\/(?:www\.)?[a-z0-9.-]+\/careers[^\s<"']*/gi,
];

/**
 * 1. CLEAN JOB DESCRIPTION
 * Solves the 5 critical Google for Jobs quality issues:
 * - Search snippet ruining (Google uses first 160 chars for GFJ preview)
 * - Leading scrape timestamps (e.g. "Posted Wednesday, August 26, 2026...")
 * - Stray dot prefixes (<p><strong>.</strong></p>)
 * - Trailing un-tagged street addresses hanging after final </p>
 * - Outbound career site URLs diverting candidates from Jobiak proxy tracking
 */
export function cleanJobDescription(rawDesc) {
  if (!rawDesc || typeof rawDesc !== "string") return "";

  let desc = rawDesc.trim();

  // 1. Strip leading scrape timestamp (e.g., "Posted Wednesday, September 2, 2026, 4:00 AM")
  desc = desc.replace(RX_POSTED_PREFIX, "");

  // 2. Strip rogue leading period / stray dot paragraph
  desc = desc.replace(RX_STRAY_DOT, "");

  // 3. Strip trailing un-tagged street addresses hanging after the final closing tag
  const lastGt = desc.lastIndexOf(">");
  if (lastGt !== -1 && lastGt < desc.length - 1) {
    const tail = desc.substring(lastGt + 1).trim();
    // If the tail has no HTML tags and resembles an address/plain text, prune it
    if (tail && !tail.includes("<")) {
      desc = desc.substring(0, lastGt + 1).trim();
    }
  }

  // 4. Remove outbound direct apply URLs diverting from proxy tracking (/gfj/)
  for (const rx of RX_APPLY_LEAKS) {
    desc = desc.replace(rx, "");
  }

  // 5. Clean duplicate strong tags and collapse multiple spaces
  desc = desc.replace(/<strong>\s*<strong>/gi, "<strong>");
  desc = desc.replace(/<\/strong>\s*<\/strong>/gi, "</strong>");

  return desc.trim();
}

/**
 * 2. VALIDATE SCHEMA.ORG/JOBPOSTING
 * Validates a job against Google for Jobs required and recommended fields.
 */
export function validateJobPostingSchema(job) {
  const errors = [];
  const warnings = [];

  // Required Google for Jobs Fields
  if (!job.title || typeof job.title !== "string" || !job.title.trim()) {
    errors.push("Missing required field: title");
  } else if (job.title.length > 100) {
    warnings.push("Title exceeds 100 characters; risk of truncation in Google for Jobs search cards");
  }

  if (!job.description || typeof job.description !== "string" || !job.description.trim()) {
    errors.push("Missing required field: description");
  } else {
    // Check for leading scrape timestamp leak
    if (RX_POSTED_PREFIX.test(job.description)) {
      warnings.push("Description contains leading scrape timestamp; ruins 160-char Google search snippet");
    }
  }

  if (!job.datePosted) {
    errors.push("Missing required field: datePosted");
  }

  if (!job.hiringOrganization && !job.company) {
    errors.push("Missing required field: hiringOrganization / company");
  }

  // Location validation (required unless telecommute/remote)
  const isRemote = job.isRemote === true || String(job.isRemote).toLowerCase() === "true";
  if (!isRemote) {
    if (!job.city && !job.state && !job.location && !job.address) {
      errors.push("Missing jobLocation: physical jobs require valid city, state, or postalAddress");
    }
  }

  // Recommended fields
  if (!job.validThrough && !job.expiresAt) {
    warnings.push("Missing recommended field: validThrough (Google defaults to 30-90 days)");
  }

  if (!job.baseSalary && !job.hiringMinRate && !job.salary) {
    warnings.push("Missing recommended field: baseSalary (salary disclosure increases CTR by ~30%)");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    score: Math.max(0, 100 - errors.length * 30 - warnings.length * 10),
  };
}

/**
 * 3. FORMAT BASE SALARY JSON-LD
 * Formats salary data into valid schema.org MonetaryAmount.
 */
export function formatBaseSalary(minRate, maxRate, payType = "HOUR", currency = "USD") {
  const min = parseFloat(minRate);
  const max = maxRate ? parseFloat(maxRate) : min;

  if (isNaN(min)) return null;

  const unit = payType.toUpperCase().includes("HOUR") ? "HOUR" : payType.toUpperCase().includes("YEAR") ? "YEAR" : "MONTH";

  return {
    "@type": "MonetaryAmount",
    currency: currency || "USD",
    value: {
      "@type": "QuantitativeValue",
      minValue: min,
      maxValue: isNaN(max) ? min : max,
      unitText: unit,
    },
  };
}

/**
 * 4. FORMAT JOB LOCATION JSON-LD
 * Formats address data into valid schema.org PostalAddress.
 */
export function formatJobLocation(job) {
  const isRemote = job.isRemote === true || String(job.isRemote).toLowerCase() === "true";

  if (isRemote) {
    return {
      "@type": "Place",
      additionalProperty: {
        "@type": "PropertyValue",
        name: "applicantLocationRequirements",
        value: job.country || "USA",
      },
    };
  }

  return {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      streetAddress: job.streetAddress || job.address || "",
      addressLocality: job.city || "",
      addressRegion: job.state || "",
      postalCode: job.postalCode || job.zip || "",
      addressCountry: job.country || "US",
    },
  };
}

/**
 * 5. NORMALIZE KEYWORD TITLE
 * Enforces strict lowercase rules for keywords management.
 */
export function normalizeKeywordTitle(title) {
  return String(title || "").trim().toLowerCase();
}
