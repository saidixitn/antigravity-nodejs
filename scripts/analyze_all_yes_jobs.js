import mongo from "../core/mongo.js";

async function analyzeAllYesJobs() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();
    console.log(`Loaded ${allJobs.length} YES Communities jobs.`);

    // 1. Analyze "Posted ..." occurrences
    const postedJobs = [];
    const rxPosted = /Posted\s+[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}(?:,\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/gi;

    for (const j of allJobs) {
      const desc = j.description || "";
      const matches = desc.match(rxPosted);
      if (matches) {
        postedJobs.push({
          jobId: j.jobId,
          title: j.title,
          matches,
          startsAt0: desc.trim().startsWith("Posted"),
          prefix: desc.slice(0, 80)
        });
      }
    }
    console.log(`\n=== 1. POSTED TIMESTAMPS ===`);
    console.log(`Total jobs with 'Posted ...': ${postedJobs.length}`);
    console.log(`Starts at 0: ${postedJobs.filter(p => p.startsAt0).length}`);
    console.log(`Sample non-starting-at-0 (if any):`, postedJobs.filter(p => !p.startsAt0).slice(0, 3));
    console.log(`Sample matches:`, postedJobs.slice(0, 5).map(p => ({ jobId: p.jobId, match: p.matches })));

    // 2. Analyze Salary in descriptions
    console.log(`\n=== 2. SALARY IN DESCRIPTIONS ===`);
    const salaryMatchesText = [];
    const minMaxRateMatches = [];

    // Check literal "$X-$X" or "$X - $X"
    const rxSalaryRange = /\$\s*[\d,]+(?:\.\d+)?\s*-\s*\$\s*[\d,]+(?:\.\d+)?\s*(?:per\s*[a-z]+)?/gi;
    // Check Hiring Min Rate / Max Rate HTML
    const rxRateTags = /<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/gi;

    for (const j of allJobs) {
      const desc = j.description || "";
      const textMatches = desc.match(rxSalaryRange);
      if (textMatches) {
        salaryMatchesText.push({ jobId: j.jobId, title: j.title, matches: textMatches });
      }

      // Check min/max rate
      let m;
      while ((m = rxRateTags.exec(desc)) !== null) {
        minMaxRateMatches.push({
          jobId: j.jobId,
          title: j.title,
          min: m[1].trim(),
          max: m[2].trim(),
          isEqual: m[1].trim() === m[2].trim(),
          fullSnippet: m[0]
        });
      }
    }

    console.log(`Jobs with literal '$X-$X': ${salaryMatchesText.length}`);
    if (salaryMatchesText.length > 0) {
      console.log(`Sample literal salary text matches:`, salaryMatchesText.slice(0, 5));
    }
    console.log(`Jobs with Hiring Min/Max Rate tags: ${minMaxRateMatches.length}`);
    const equalRates = minMaxRateMatches.filter(m => m.isEqual);
    console.log(`Jobs where Min Rate == Max Rate: ${equalRates.length}`);
    console.log(`Sample equal rates:`, equalRates.slice(0, 10));

    // Also check how the frontend renders "$50,000-$50,000 per year"
    // Does the job doc have baseSalary or salary fields?
    const sampleJob2 = allJobs.find(j => j.jobId === "6ad71a24dd6a790397e93dc3");
    console.log("Job 2 salary-related fields in document:", {
      salary: sampleJob2?.salary,
      baseSalary: sampleJob2?.baseSalary,
      hiringMinRate: sampleJob2?.hiringMinRate,
      hiringMaxRate: sampleJob2?.hiringMaxRate,
      payType: sampleJob2?.payType,
      hiringRate: sampleJob2?.hiringRate,
      minSalary: sampleJob2?.minSalary,
      maxSalary: sampleJob2?.maxSalary
    });

    // 3. Analyze Trailing Location / Text at the end of description
    console.log(`\n=== 3. TRAILING TEXT AT END OF DESCRIPTION ===`);
    const trailingList = [];
    for (const j of allJobs) {
      const desc = (j.description || "").trim();
      const lastGt = desc.lastIndexOf(">");
      if (lastGt !== -1 && lastGt < desc.length - 1) {
        const tail = desc.substring(lastGt + 1).trim();
        if (tail) {
          trailingList.push({
            jobId: j.jobId,
            title: j.title,
            tail: tail,
            location: j.location,
            city: j.city,
            state: j.state
          });
        }
      }
    }
    console.log(`Total jobs with trailing text after last '>': ${trailingList.length}`);
    console.log(`Sample trailing texts:`, trailingList.slice(0, 15));

  } catch (err) {
    console.error("Error in analyzeAllYesJobs:", err);
  } finally {
    await mongo.close();
  }
}

analyzeAllYesJobs();
