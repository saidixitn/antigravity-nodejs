import mongo from "../core/mongo.js";

async function run() {
  try {
    console.log("--- FETCHING LIVE URLS ---");
    const u1 = "https://yescommunities.com/gfj/office-administrator-westfield-in-6ab3f2d70cb6c603f9f704e9";
    const u2 = "https://yescommunities.com/gfj/community-manager-in-training-la-vergne-tn-6ad71a24dd6a790397e93dc3";

    try {
      const res1 = await fetch(u1);
      const text1 = await res1.text();
      console.log("URL 1 status:", res1.status, "length:", text1.length);
      const m1 = text1.match(/Posted\s+[^<]+/gi);
      console.log("URL 1 Posted matches:", m1);
      const s1 = text1.match(/\$\s*[\d,]+(?:\s*-\s*\$\s*[\d,]+)?\s*per\s*[a-z]+/gi);
      console.log("URL 1 Salary matches:", s1);
    } catch (e) {
      console.error("URL 1 fetch failed:", e.message);
    }

    try {
      const res2 = await fetch(u2);
      const text2 = await res2.text();
      console.log("URL 2 status:", res2.status, "length:", text2.length);
      const m2 = text2.match(/Posted\s+[^<]+/gi);
      console.log("URL 2 Posted matches:", m2);
      const s2 = text2.match(/\$\s*[\d,]+(?:\s*-\s*\$\s*[\d,]+)?\s*per\s*[a-z]+/gi);
      console.log("URL 2 Salary matches:", s2);
      const loc2 = text2.match(/La\s*Vergne[^\n<]*/gi);
      console.log("URL 2 La Vergne matches:", loc2);
    } catch (e) {
      console.error("URL 2 fetch failed:", e.message);
    }

    // Now let's examine prod_jobiak_ai.job
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    // Let's sample 10 jobs from YES Communities in prod_jobiak_ai
    const sampleJobs = await jobCol.find({ employerId: empId }).limit(10).toArray();
    console.log(`\nSampled ${sampleJobs.length} jobs for YES Communities:`);
    for (const j of sampleJobs) {
      console.log(`- [${j.jobId}] ${j.title}`);
      console.log("  Desc start:", JSON.stringify(j.description?.slice(0, 80)));
      console.log("  Desc end  :", JSON.stringify(j.description?.slice(-80)));
    }

  } catch (err) {
    console.error("Fatal:", err);
  } finally {
    await mongo.close();
  }
}

run();
