import mongo from "../core/mongo.js";

async function fullAudit() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();
    console.log(`Auditing all ${allJobs.length} YES Communities jobs...`);

    // Patterns
    const rxPosted = /^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?\s*/i;
    const rxRateTags = /<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/i;

    let countPosted = 0;
    let countTrailingLoc = 0;
    let countEqualSalaryField = 0;
    let countEqualRateDesc = 0;
    let countAnyIssue = 0;

    const affectedJobs = [];

    for (const j of allJobs) {
      const desc = j.description || "";
      const hasPosted = rxPosted.test(desc);

      // Trailing location: text after the last '>'
      let hasTrailingLoc = false;
      let trailingText = "";
      const lastGt = desc.lastIndexOf(">");
      if (lastGt !== -1 && lastGt < desc.length - 1) {
        trailingText = desc.substring(lastGt + 1).trim();
        if (trailingText && !trailingText.includes("<")) {
          hasTrailingLoc = true;
        }
      }

      // Salary field check
      let hasEqualSalaryField = false;
      if (j.salary) {
        const sm = j.salary.match(/\$?(\d[\d,.]*)\s*(?:USD)?\s*-\s*\$?(\d[\d,.]*)\s*(?:USD)?\s*(.*)/i);
        if (sm) {
          const v1 = parseFloat(sm[1].replace(/,/g, ''));
          const v2 = parseFloat(sm[2].replace(/,/g, ''));
          if (v1 === v2) hasEqualSalaryField = true;
        }
      }

      // Desc equal min/max rate
      let hasEqualRateDesc = false;
      let rateMatch = null;
      const rm = desc.match(rxRateTags);
      if (rm && rm[1].trim() === rm[2].trim()) {
        hasEqualRateDesc = true;
        rateMatch = { min: rm[1].trim(), max: rm[2].trim(), raw: rm[0] };
      }

      if (hasPosted) countPosted++;
      if (hasTrailingLoc) countTrailingLoc++;
      if (hasEqualSalaryField) countEqualSalaryField++;
      if (hasEqualRateDesc) countEqualRateDesc++;

      if (hasPosted || hasTrailingLoc || hasEqualSalaryField || hasEqualRateDesc) {
        countAnyIssue++;
        affectedJobs.push({
          jobId: j.jobId,
          title: j.title,
          status: j.status,
          isActive: j.isActive,
          hasPosted,
          hasTrailingLoc,
          trailingText,
          hasEqualSalaryField,
          salaryField: j.salary,
          hasEqualRateDesc,
          rateMatch
        });
      }
    }

    console.log(`\n=== AUDIT SUMMARY FOR YES COMMUNITIES ===`);
    console.log(`Total jobs in DB: ${allJobs.length}`);
    console.log(`Total jobs with ANY of the 3 issues: ${countAnyIssue}`);
    console.log(`1. With leading 'Posted ...' timestamp: ${countPosted}`);
    console.log(`2. With trailing un-tagged location text: ${countTrailingLoc}`);
    console.log(`3. With equal min/max in 'salary' field: ${countEqualSalaryField}`);
    console.log(`4. With equal min/max rate in description: ${countEqualRateDesc}`);

    // Active vs removed breakdown
    const activeAffected = affectedJobs.filter(j => j.status === 'posted' && j.isActive);
    console.log(`\nActive posted jobs affected: ${activeAffected.length} (out of 854 active)`);

    // Specifically check the two sample jobs mentioned by user
    const sample1 = affectedJobs.find(j => j.jobId === "6ab3f2d70cb6c603f9f704e9") || allJobs.find(j => j.jobId === "6ab3f2d70cb6c603f9f704e9");
    const sample2 = affectedJobs.find(j => j.jobId === "6ad71a24dd6a790397e93dc3");

    console.log("\n=== USER SAMPLE 1: Office Administrator (Westfield, IN) ===");
    console.log("JobId:", sample1.jobId);
    console.log("Status:", sample1.status, "isActive:", sample1.isActive);
    console.log("Description start:", JSON.stringify(sample1.description?.slice(0, 100)));
    console.log("Description end  :", JSON.stringify(sample1.description?.slice(-100)));

    console.log("\n=== USER SAMPLE 2: Community Manager-in-Training (La Vergne, TN) ===");
    console.log("JobId:", sample2.jobId);
    console.log("Status:", sample2.status, "isActive:", sample2.isActive);
    console.log("hasPosted:", sample2.hasPosted);
    console.log("hasTrailingLoc:", sample2.hasTrailingLoc, "->", JSON.stringify(sample2.trailingText));
    console.log("hasEqualSalaryField:", sample2.hasEqualSalaryField, "->", sample2.salaryField);
    console.log("hasEqualRateDesc:", sample2.hasEqualRateDesc, "->", sample2.rateMatch);

  } catch (e) {
    console.error(e);
  } finally {
    await mongo.close();
  }
}

fullAudit();
