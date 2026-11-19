import fs from "fs";
import mongo from "../core/mongo.js";

function cleanDescriptionText(rawDesc) {
  if (!rawDesc || typeof rawDesc !== "string") return "";

  let desc = rawDesc.trim();

  // 1. Remove leading scrape timestamp:
  // e.g. "Posted Tuesday, September 1, 2026, 6:00 AM" or "Posted Wednesday, August 26, 2026, 4:00 AM"
  const rxPosted = /^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?\s*/i;
  desc = desc.replace(rxPosted, "");

  // 2. Remove trailing plain-text address / location hanging after the last closing tag
  const lastGt = desc.lastIndexOf(">");
  if (lastGt !== -1 && lastGt < desc.length - 1) {
    const tail = desc.substring(lastGt + 1).trim();
    if (tail && !tail.includes("<")) {
      desc = desc.substring(0, lastGt + 1).trim();
    }
  }

  // 3. Fix redundant identical Min/Max rate in description HTML
  // e.g. <p><strong>Hiring Min Rate:</strong> 50,000 USD</p><p><strong>Hiring Max Rate:</strong> 50,000 USD</p>
  // -> <p><strong>Hiring Rate:</strong> 50,000 USD</p>
  // Or if it's hourly: <p><strong>Hiring Min Rate:</strong> 17 USD</p><p><strong>Hiring Max Rate:</strong> 17 USD</p>
  // -> <p><strong>Hiring Rate:</strong> 17 USD</p>
  const rxRateTags = /<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/gi;
  desc = desc.replace(rxRateTags, (match, min, max) => {
    if (min.trim() === max.trim()) {
      return `<p><strong>Hiring Rate:</strong> ${min.trim()}</p>`;
    }
    return match;
  });

  return desc.trim();
}

function cleanSalaryField(rawSalary) {
  if (!rawSalary || typeof rawSalary !== "string") return rawSalary;
  // e.g. "$50000 - $50000 Per Year" -> "$50,000 per year"
  // "$20 - $20 Per Hour" -> "$20 per hour"
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

async function exportCleanedData() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();
    console.log(`Processing ${allJobs.length} jobs...`);

    const rxPosted = /^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?\s*/i;
    const rxRateTags = /<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/i;

    const results = [];

    for (const j of allJobs) {
      const originalDesc = j.description || "";
      const originalSalary = j.salary || null;

      const hasPosted = rxPosted.test(originalDesc);

      let hasTrailingLoc = false;
      let trailingText = "";
      const lastGt = originalDesc.lastIndexOf(">");
      if (lastGt !== -1 && lastGt < originalDesc.length - 1) {
        trailingText = originalDesc.substring(lastGt + 1).trim();
        if (trailingText && !trailingText.includes("<")) {
          hasTrailingLoc = true;
        }
      }

      let hasEqualSalaryField = false;
      const modifiedSalary = cleanSalaryField(originalSalary);
      if (modifiedSalary !== originalSalary) {
        hasEqualSalaryField = true;
      }

      let hasEqualRateDesc = false;
      const rm = originalDesc.match(rxRateTags);
      if (rm && rm[1].trim() === rm[2].trim()) {
        hasEqualRateDesc = true;
      }

      if (hasPosted || hasTrailingLoc || hasEqualSalaryField || hasEqualRateDesc) {
        const modifiedDesc = cleanDescriptionText(originalDesc);

        results.push({
          jobId: j.jobId,
          title: j.title,
          location: j.location,
          status: j.status,
          isActive: j.isActive,
          url: j.submittedUrl || `https://yescommunities.com/gfj/${j.jobId}`,
          issues: {
            hasPostedTimestamp: hasPosted,
            hasTrailingLocation: hasTrailingLoc,
            trailingLocationText: trailingText || null,
            hasRedundantSalaryField: hasEqualSalaryField,
            hasRedundantRateInDesc: hasEqualRateDesc
          },
          salary: {
            original: originalSalary,
            modified: modifiedSalary
          },
          description: {
            original: originalDesc,
            modified: modifiedDesc
          }
        });
      }
    }

    console.log(`Found ${results.length} jobs needing modification.`);

    // Write full dataset to JSON
    const outputPath = "./scripts/yes_communities_cleaned_data.json";
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Wrote full dataset to ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);

    // Write a summary CSV for easy viewing/sharing
    const csvHeader = "JobId,Title,Location,Status,IsActive,HasPostedTimestamp,HasTrailingLocation,TrailingText,OriginalSalary,ModifiedSalary\n";
    const csvRows = results.map(r => [
      `"${r.jobId}"`,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${(r.location || '').replace(/"/g, '""')}"`,
      `"${r.status}"`,
      r.isActive,
      r.issues.hasPostedTimestamp,
      r.issues.hasTrailingLocation,
      `"${(r.issues.trailingLocationText || '').replace(/"/g, '""')}"`,
      `"${(r.salary.original || '').replace(/"/g, '""')}"`,
      `"${(r.salary.modified || '').replace(/"/g, '""')}"`
    ].join(",")).join("\n");

    const csvPath = "./scripts/yes_communities_audit_summary.csv";
    fs.writeFileSync(csvPath, csvHeader + csvRows);
    console.log(`Wrote summary CSV to ${csvPath} (${(fs.statSync(csvPath).size / 1024).toFixed(1)} KB)`);

  } catch (err) {
    console.error("Export error:", err);
  } finally {
    await mongo.close();
  }
}

exportCleanedData();
