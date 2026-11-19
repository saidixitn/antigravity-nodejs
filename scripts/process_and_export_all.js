import fs from "fs";
import path from "path";
import mongo from "../core/mongo.js";

export function cleanFullDescription(rawDesc) {
  if (!rawDesc || typeof rawDesc !== "string") return "";

  let desc = rawDesc.trim();

  // 1. Remove leading scrape timestamps (e.g. "Posted Tuesday, September 1, 2026, 6:00 AM")
  const rxPosted = /^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?\s*/i;
  desc = desc.replace(rxPosted, "");

  // 2. Remove stray dot paragraph at start (e.g. "<p><strong>.</strong></p>")
  desc = desc.replace(/^\s*<p><strong>\s*\.\s*<\/strong><\/p>\s*/i, "");

  // 3. Remove safety scam disclaimer & career site URL leak
  const rxSafety = /<p>\s*Your safety matters to us[\s\S]*?visit yescommunities\.com\/careers\/? directly for confirmed position openings\.?\s*<\/p>\s*/gi;
  desc = desc.replace(rxSafety, "");

  // 4. Remove trailing plain text / location hanging after the last closing tag
  const lastGt = desc.lastIndexOf(">");
  if (lastGt !== -1 && lastGt < desc.length - 1) {
    const tail = desc.substring(lastGt + 1).trim();
    if (tail && !tail.includes("<")) {
      desc = desc.substring(0, lastGt + 1).trim();
    }
  }

  // 5. Normalize redundant equal Hiring Min Rate & Hiring Max Rate in HTML
  const rxRateTags = /<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/gi;
  desc = desc.replace(rxRateTags, (match, min, max) => {
    if (min.trim() === max.trim()) {
      return `<p><strong>Hiring Rate:</strong> ${min.trim()}</p>`;
    }
    return match;
  });

  return desc.trim();
}

export function cleanSalaryString(rawSalary) {
  if (!rawSalary || typeof rawSalary !== "string") return rawSalary;
  const m = rawSalary.match(/\$?(\d[\d,.]*)\s*(?:USD)?\s*-\s*\$?(\d[\d,.]*)\s*(?:USD)?\s*(.*)/i);
  if (m) {
    const v1 = parseFloat(m[1].replace(/,/g, ''));
    const v2 = parseFloat(m[2].replace(/,/g, ''));
    if (v1 === v2) {
      const formattedNum = v1 >= 1000 ? v1.toLocaleString('en-US') : v1.toString();
      const period = (m[3] || "").toLowerCase().trim();
      return `$${formattedNum} ${period}`.trim();
    }
  }
  return rawSalary;
}

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

function safeWrite(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`Saved: ${filePath} (${(fs.statSync(filePath).size / (1024 * 1024)).toFixed(2)} MB)`);
    return true;
  } catch (err) {
    console.warn(`Could not write to ${filePath} (${err.code}). Trying fallback...`);
    return false;
  }
}

async function processAndExportAll() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();
    console.log(`Processing all ${allJobs.length} jobs for YES Communities...`);

    const rxPosted = /^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?\s*/i;
    const rxStrayDot = /^\s*<p><strong>\s*\.\s*<\/strong><\/p>\s*/i;
    const rxSafety = /Your safety matters to us[\s\S]*?visit yescommunities\.com\/careers\/? directly for confirmed position openings\.?/i;
    const rxRateTags = /<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/i;

    const exportList = [];
    const groupStats = {};

    let totalSafetyMatches = 0;

    for (const j of allJobs) {
      const origDesc = j.description || "";
      const origSalary = j.salary || null;

      const hasPosted = rxPosted.test(origDesc);
      const hasStrayDot = rxStrayDot.test(origDesc);
      const hasSafetyDisclaimer = rxSafety.test(origDesc);
      if (hasSafetyDisclaimer) totalSafetyMatches++;

      let hasTrailingLoc = false;
      let trailingText = "";
      const lastGt = origDesc.lastIndexOf(">");
      if (lastGt !== -1 && lastGt < origDesc.length - 1) {
        trailingText = origDesc.substring(lastGt + 1).trim();
        if (trailingText && !trailingText.includes("<")) {
          hasTrailingLoc = true;
        }
      }

      let hasEqualRateDesc = false;
      const rm = origDesc.match(rxRateTags);
      if (rm && rm[1].trim() === rm[2].trim()) {
        hasEqualRateDesc = true;
      }

      const modSalary = cleanSalaryString(origSalary);
      const hasEqualSalary = modSalary !== origSalary;

      const needsFix = hasPosted || hasStrayDot || hasSafetyDisclaimer || hasTrailingLoc || hasEqualRateDesc || hasEqualSalary;

      const modDesc = cleanFullDescription(origDesc);

      // Track group stats
      const title = j.title || "Untitled";
      if (!groupStats[title]) {
        groupStats[title] = { total: 0, active: 0, needsFix: 0, posted: 0, safety: 0, trailingLoc: 0, equalRate: 0, equalSalary: 0, strayDots: 0 };
      }
      groupStats[title].total++;
      if (j.status === 'posted' && j.isActive) groupStats[title].active++;
      if (needsFix) groupStats[title].needsFix++;
      if (hasPosted) groupStats[title].posted++;
      if (hasSafetyDisclaimer) groupStats[title].safety++;
      if (hasTrailingLoc) groupStats[title].trailingLoc++;
      if (hasEqualRateDesc) groupStats[title].equalRate++;
      if (hasEqualSalary) groupStats[title].equalSalary++;
      if (hasStrayDot) groupStats[title].strayDots++;

      exportList.push({
        jobId: j.jobId,
        title: j.title,
        location: j.location,
        status: j.status,
        isActive: j.isActive,
        url: j.submittedUrl || `https://yescommunities.com/gfj/${j.jobId}`,
        needsFix,
        issues: {
          hasPostedTimestamp: hasPosted,
          hasStrayDot: hasStrayDot,
          hasSafetyDisclaimer: hasSafetyDisclaimer,
          hasTrailingLocation: hasTrailingLoc,
          trailingLocationText: trailingText || null,
          hasEqualMinMaxRateInDesc: hasEqualRateDesc,
          hasEqualRangeInSalaryField: hasEqualSalary
        },
        salary: {
          original: origSalary,
          modified: modSalary
        },
        description: {
          original: origDesc,
          modified: modDesc
        }
      });
    }

    const modifiedOnly = exportList.filter(e => e.needsFix);
    console.log(`\nSummary: ${allJobs.length} total, ${modifiedOnly.length} needing fixes. (Safety disclaimer in ${totalSafetyMatches} jobs)`);

    // 1. Write full modified dataset to JSON
    const fullJsonPath = path.resolve("./scripts/yes_communities_all_fixed_jobs.json");
    fs.writeFileSync(fullJsonPath, JSON.stringify(modifiedOnly, null, 2));
    console.log(`Saved ${modifiedOnly.length} jobs to: ${fullJsonPath}`);

    // 2. Generate comprehensive CSV
    const headers = [
      "JobId",
      "Title",
      "Status",
      "IsActive",
      "OriginalDescription",
      "ModifiedDescription",
      "OriginalSalary",
      "ModifiedSalary",
      "Url"
    ];

    const rows = [headers.map(escapeCsvField).join(",")];
    for (const r of modifiedOnly) {
      rows.push([
        escapeCsvField(r.jobId),
        escapeCsvField(r.title),
        escapeCsvField(r.status),
        escapeCsvField(r.isActive),
        escapeCsvField(r.description.original),
        escapeCsvField(r.description.modified),
        escapeCsvField(r.salary.original),
        escapeCsvField(r.salary.modified),
        escapeCsvField(r.url)
      ].join(","));
    }

    const csvContent = "\uFEFF" + rows.join("\r\n");

    const rootCsvPath = path.resolve("./yes_communities_descriptions.csv");
    const rootCleanedCsvPath = path.resolve("./yes_communities_cleaned_descriptions.csv");
    const scriptsCsvPath = path.resolve("./scripts/yes_communities_descriptions.csv");
    const brainCsvPath = "C:\\Users\\JOBIAK\\.gemini\\antigravity\\brain\\f8daab73-6578-4ac6-ba53-cc0d3974bd51\\yes_communities_descriptions.csv";

    safeWrite(rootCsvPath, csvContent);
    safeWrite(rootCleanedCsvPath, csvContent);
    safeWrite(scriptsCsvPath, csvContent);
    safeWrite(brainCsvPath, csvContent);

    // Print group summary table
    console.log("\n=== GROUP SUMMARY STATS ===");
    console.table(groupStats);

  } catch (err) {
    console.error("Error in processAndExportAll:", err);
  } finally {
    await mongo.close();
  }
}

processAndExportAll();
