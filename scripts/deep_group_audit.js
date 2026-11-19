import mongo from "../core/mongo.js";

async function deepAnalyzeAndGroup() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();
    console.log(`Analyzing ${allJobs.length} YES Communities jobs in detail...`);

    // Group jobs by title
    const titleGroups = {};
    for (const j of allJobs) {
      const title = j.title || "Untitled";
      if (!titleGroups[title]) {
        titleGroups[title] = [];
      }
      titleGroups[title].push(j);
    }

    console.log(`\nDistinct Job Titles (${Object.keys(titleGroups).length}):`);
    for (const [title, jobs] of Object.entries(titleGroups)) {
      console.log(`- ${title}: ${jobs.length} jobs (${jobs.filter(j => j.status === 'posted' && j.isActive).length} active)`);
    }

    // Now let's examine each group for issues:
    // 1. Leading Timestamps: e.g. "Posted Tuesday, September 1, 2026, 6:00 AM" or any other date
    // 2. Trailing text: addresses, cities, stray characters after last '>'
    // 3. Salary anomalies:
    //    - Redundant identical ranges like $50,000-$50,000 or $20-$20
    //    - Hiring Min Rate == Hiring Max Rate in HTML
    //    - "USD" or missing spaces
    // 4. Broken HTML tags: stray <strong>, unmatched tags, double tags
    // 5. Stray dots: <p><strong>.</strong></p>
    // 6. External career site / ATS URLs leaking in description:
    //    e.g. "visit yescommunities.com/careers/ directly for confirmed position openings"
    //    or Dayforce links
    // 7. Contact info / email leaks: "@yescommunities.com"
    // 8. Encoding artifacts: &amp;, &nbsp;, \n\r, unicode quirks

    const groupAnalysis = {};

    for (const [title, jobs] of Object.entries(titleGroups)) {
      const issuesFound = {
        total: jobs.length,
        active: jobs.filter(j => j.status === 'posted' && j.isActive).length,
        leadingTimestamp: 0,
        trailingTextAfterTag: 0,
        trailingTextExamples: new Set(),
        equalMinMaxRateDesc: 0,
        equalSalaryField: 0,
        strayDots: 0,
        atsCareerUrls: 0,
        emptyOrShortDesc: 0,
        brokenTags: 0,
        sampleDescStart: jobs[0]?.description?.slice(0, 150),
        sampleDescEnd: jobs[0]?.description?.slice(-150)
      };

      for (const j of jobs) {
        const desc = j.description || "";
        if (!desc || desc.length < 100) issuesFound.emptyOrShortDesc++;

        // Leading timestamp
        if (/^\s*Posted\s+[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2}/i.test(desc)) {
          issuesFound.leadingTimestamp++;
        }

        // Trailing text
        const lastGt = desc.lastIndexOf(">");
        if (lastGt !== -1 && lastGt < desc.length - 1) {
          const tail = desc.substring(lastGt + 1).trim();
          if (tail && !tail.includes("<")) {
            issuesFound.trailingTextAfterTag++;
            if (issuesFound.trailingTextExamples.size < 3) {
              issuesFound.trailingTextExamples.add(tail);
            }
          }
        }

        // Equal Min/Max Rate in description
        const rm = desc.match(/<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/i);
        if (rm && rm[1].trim() === rm[2].trim()) {
          issuesFound.equalMinMaxRateDesc++;
        }

        // Equal in salary field
        if (j.salary) {
          const sm = j.salary.match(/\$?(\d[\d,.]*)\s*(?:USD)?\s*-\s*\$?(\d[\d,.]*)\s*(?:USD)?\s*(.*)/i);
          if (sm) {
            const v1 = parseFloat(sm[1].replace(/,/g, ''));
            const v2 = parseFloat(sm[2].replace(/,/g, ''));
            if (v1 === v2) issuesFound.equalSalaryField++;
          }
        }

        // Stray dot
        if (/<p><strong>\s*\.\s*<\/strong><\/p>/i.test(desc) || /^\s*\.\s*/.test(desc)) {
          issuesFound.strayDots++;
        }

        // Career / ATS leaks
        if (/visit\s+yescommunities\.com\/careers/i.test(desc) || /dayforcehcm\.com/i.test(desc)) {
          issuesFound.atsCareerUrls++;
        }
      }

      issuesFound.trailingTextExamples = Array.from(issuesFound.trailingTextExamples);
      groupAnalysis[title] = issuesFound;
    }

    console.log("\n=== GROUP ANALYSIS RESULTS ===");
    for (const [title, data] of Object.entries(groupAnalysis)) {
      console.log(`\n--- Title: ${title} (Total: ${data.total}, Active: ${data.active}) ---`);
      console.log(`  Leading Timestamps: ${data.leadingTimestamp}`);
      console.log(`  Trailing Locations/Addresses: ${data.trailingTextAfterTag} (e.g. ${data.trailingTextExamples.join(" | ")})`);
      console.log(`  Equal Min/Max Rate in Desc: ${data.equalMinMaxRateDesc}`);
      console.log(`  Equal Range in Salary Field: ${data.equalSalaryField}`);
      console.log(`  ATS Career URL leaks: ${data.atsCareerUrls}`);
      console.log(`  Stray dots: ${data.strayDots}`);
      console.log(`  Sample Desc Start: ${JSON.stringify(data.sampleDescStart)}`);
      console.log(`  Sample Desc End  : ${JSON.stringify(data.sampleDescEnd)}`);
    }

  } catch (e) {
    console.error(e);
  } finally {
    await mongo.close();
  }
}

deepAnalyzeAndGroup();
