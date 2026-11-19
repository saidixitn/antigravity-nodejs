import fs from "fs";
import path from "path";
import mongo from "../core/mongo.js";
import { cleanFullDescription, cleanSalaryString } from "./process_and_export_all.js";

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

async function comprehensiveCheckAndBuildCsvs() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();
    console.log(`Loaded ${allJobs.length} jobs directly from prod_jobiak_ai.job.`);

    const rxPosted = /^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?\s*/i;
    const rxStrayDot = /^\s*<p><strong>\s*\.\s*<\/strong><\/p>\s*/i;
    const rxSafety = /Your safety matters to us[\s\S]*?visit yescommunities\.com\/careers\/? directly for confirmed position openings\.?/i;
    const rxRateTags = /<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/i;

    let corruptedDescriptions = 0;
    let emptyModified = 0;
    const allRecords = [];

    for (const j of allJobs) {
      const origDesc = j.description || "";
      const origSalary = j.salary || null;

      const hasPosted = rxPosted.test(origDesc);
      const hasStrayDot = rxStrayDot.test(origDesc);
      const hasSafety = rxSafety.test(origDesc);

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

      const needsFix = hasPosted || hasStrayDot || hasSafety || hasTrailingLoc || hasEqualRateDesc || hasEqualSalary;

      const modDesc = cleanFullDescription(origDesc);

      // Quality validation on modified description
      if (needsFix && (!modDesc || modDesc.length < 50)) {
        emptyModified++;
        console.error(`ERROR: Empty or suspicious modified description for ${j.jobId}`);
      }

      // Check if any unwanted patterns survived
      if (rxPosted.test(modDesc)) {
        console.error(`ERROR: Posted timestamp still present in ${j.jobId}`);
        corruptedDescriptions++;
      }
      if (rxSafety.test(modDesc)) {
        console.error(`ERROR: Safety disclaimer still present in ${j.jobId}`);
        corruptedDescriptions++;
      }
      if (rxStrayDot.test(modDesc)) {
        console.error(`ERROR: Stray dot still present in ${j.jobId}`);
        corruptedDescriptions++;
      }

      const issuesList = [];
      if (hasPosted) issuesList.push("LEADING_SCRAPE_TIMESTAMP");
      if (hasSafety) issuesList.push("SAFETY_SCAM_DISCLAIMER");
      if (hasTrailingLoc) issuesList.push(`TRAILING_LOCATION (${trailingText})`);
      if (hasEqualRateDesc) issuesList.push("EQUAL_MIN_MAX_RATE_IN_DESC");
      if (hasEqualSalary) issuesList.push(`EQUAL_MIN_MAX_SALARY_FIELD (${origSalary} -> ${modSalary})`);
      if (hasStrayDot) issuesList.push("STRAY_DOT_PREFIX");

      allRecords.push({
        jobId: j.jobId,
        title: j.title || "",
        location: j.location || "",
        status: j.status || "",
        isActive: j.isActive === true ? "true" : "false",
        needsFix: needsFix ? "true" : "false",
        issuesDetected: issuesList.join("; ") || "NONE",
        originalSalary: origSalary || "",
        modifiedSalary: modSalary || "",
        originalDescription: origDesc,
        modifiedDescription: modDesc,
        url: j.submittedUrl || `https://yescommunities.com/gfj/${j.jobId}`
      });
    }

    console.log("\n=== QUALITY CHECK RESULTS ===");
    console.log(`Total jobs scanned: ${allRecords.length}`);
    console.log(`Corrupted / surviving defect count: ${corruptedDescriptions}`);
    console.log(`Empty modified count: ${emptyModified}`);
    console.log(`Jobs requiring fixes: ${allRecords.filter(r => r.needsFix === "true").length}`);
    console.log(`Jobs already clean: ${allRecords.filter(r => r.needsFix === "false").length}`);

    // Build CSV Headers
    const headers = [
      "JobId",
      "Title",
      "Location",
      "Status",
      "IsActive",
      "NeedsFix",
      "IssuesDetected",
      "OriginalSalary",
      "ModifiedSalary",
      "OriginalDescription",
      "ModifiedDescription",
      "Url"
    ];

    function toCsv(records) {
      const rows = [headers.map(escapeCsvField).join(",")];
      for (const r of records) {
        rows.push([
          escapeCsvField(r.jobId),
          escapeCsvField(r.title),
          escapeCsvField(r.location),
          escapeCsvField(r.status),
          escapeCsvField(r.isActive),
          escapeCsvField(r.needsFix),
          escapeCsvField(r.issuesDetected),
          escapeCsvField(r.originalSalary),
          escapeCsvField(r.modifiedSalary),
          escapeCsvField(r.originalDescription),
          escapeCsvField(r.modifiedDescription),
          escapeCsvField(r.url)
        ].join(","));
      }
      return "\uFEFF" + rows.join("\r\n");
    }

    // 1. ALL 1,295 JOBS CSV
    const allCsv = toCsv(allRecords);
    const pathAllRoot = path.resolve("./yes_communities_all_1295_jobs.csv");
    const pathAllArtifact = "C:\\Users\\JOBIAK\\.gemini\\antigravity\\brain\\f8daab73-6578-4ac6-ba53-cc0d3974bd51\\yes_communities_all_1295_jobs.csv";
    fs.writeFileSync(pathAllRoot, allCsv, "utf8");
    fs.writeFileSync(pathAllArtifact, allCsv, "utf8");
    console.log(`Written ALL JOBS CSV: ${pathAllRoot} (${(fs.statSync(pathAllRoot).size / (1024 * 1024)).toFixed(2)} MB)`);

    // 2. MODIFIED ONLY (897 JOBS) CSV
    const modifiedRecords = allRecords.filter(r => r.needsFix === "true");
    const modifiedCsv = toCsv(modifiedRecords);
    const pathModRoot = path.resolve("./yes_communities_modified_897_jobs.csv");
    const pathModArtifact = "C:\\Users\\JOBIAK\\.gemini\\antigravity\\brain\\f8daab73-6578-4ac6-ba53-cc0d3974bd51\\yes_communities_modified_897_jobs.csv";
    fs.writeFileSync(pathModRoot, modifiedCsv, "utf8");
    fs.writeFileSync(pathModArtifact, modifiedCsv, "utf8");
    console.log(`Written MODIFIED JOBS CSV: ${pathModRoot} (${(fs.statSync(pathModRoot).size / (1024 * 1024)).toFixed(2)} MB)`);

  } catch (err) {
    console.error("Fatal check error:", err);
  } finally {
    await mongo.close();
  }
}

comprehensiveCheckAndBuildCsvs();
