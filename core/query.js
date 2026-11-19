/**
 * query.js - Centralized Production Query Filters & Utilities
 * ============================================================
 * Production-tested Google views/clicks filters and date aggregators.
 */

// Production Google View Eligibility Filter (Matches Section 5 of gemini.md)
export const GOOGLE_VIEW_FILTER = {
  isBot: false,
  browserType: { $ne: "Unknown" },
  deviceType: { $ne: "Unknown" },
  isFromGoogle: true,
};

// Common variations of field names across collections
export const IP_FIELDS = ["ip", "ipAddress", "clientIp", "remoteAddress"];
export const JOB_ID_FIELDS = ["jobId", "job_id", "jobPubJobId", "jobPostingId", "childJobId"];

/**
 * Builds MongoDB $ifNull expression to get first available field
 */
export function getFirstFieldExpr(fields) {
  let expr = null;
  for (let i = fields.length - 1; i >= 0; i--) {
    const val = `$${fields[i]}`;
    expr = expr === null ? val : { $ifNull: [val, expr] };
  }
  return expr;
}

/**
 * Generates an efficient aggregation stage to project UTC Day, IP, JobId
 */
export function buildViewProjectionStage(dateField = "createdDt") {
  return [
    {
      $project: {
        _id: 0,
        day: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: `$${dateField}`,
            timezone: "UTC",
          },
        },
        ip: getFirstFieldExpr(IP_FIELDS),
        jobId: getFirstFieldExpr(JOB_ID_FIELDS),
      },
    },
    {
      $match: {
        ip: { $nin: [null, ""] },
        jobId: { $nin: [null, ""] },
      },
    },
  ];
}

/**
 * Format Date to YYYY-MM-DD
 */
export function formatDate(date) {
  return new Date(date).toISOString().split("T")[0];
}

export default {
  GOOGLE_VIEW_FILTER,
  IP_FIELDS,
  JOB_ID_FIELDS,
  getFirstFieldExpr,
  buildViewProjectionStage,
  formatDate,
};
