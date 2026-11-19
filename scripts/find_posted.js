import mongo from "../core/mongo.js";

async function run() {
  try {
    const prodDb = await mongo.db("prod_jobiak_ai");
    const id1 = "6ab3f2d70cb6c603f9f704e9";

    const j1 = await prodDb.collection("job").findOne({ $or: [{ jobId: id1 }, { _id: id1 }] });
    console.log("Prod job 1 keys:", Object.keys(j1 || {}));
    console.log("Prod job 1 datePosted:", j1?.datePosted);
    console.log("Prod job 1 created_at / updatedAt:", j1?.created_at, j1?.updatedAt);
    console.log("Prod job 1 raw / full obj:", JSON.stringify(j1, null, 2).slice(0, 500));

    // Search across prod_jobiak_ai collections for this jobId
    const cols = ["job", "job28", "jobTracking", "chatGptDescriptions", "jobsJsonLog"];
    for (const c of cols) {
      try {
        const found = await prodDb.collection(c).findOne({ $or: [{ jobId: id1 }, { _id: id1 }] });
        if (found) {
          console.log(`Found in prod_jobiak_ai.${c}!`);
        }
      } catch (e) {}
    }

    // Search for "Posted Tuesday, September 1, 2026" anywhere in prod_jobiak_ai.job
    const postedSept = await prodDb.collection("job").find({
      description: { $regex: /Posted\s+Tuesday,\s+September\s+1,\s+2026/i }
    }).toArray();
    console.log("Found with 'Posted Tuesday, September 1, 2026':", postedSept.length);
    for (const j of postedSept) {
      console.log(`- ${j.jobId} : ${j.title}`);
    }

    // Search for how many YES Communities jobs in prod_jobiak_ai.job have "Posted " in description
    const empId = "6a86c3d7060e8f0b78b0dc66";
    const postedYes = await prodDb.collection("job").find({
      employerId: empId,
      description: { $regex: /Posted\s+[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}/i }
    }).project({ jobId: 1, title: 1, description: 1 }).toArray();

    console.log(`YES Communities jobs with 'Posted <Day>, <Date>...': ${postedYes.length}`);
    for (const j of postedYes.slice(0, 5)) {
      const match = j.description.match(/Posted\s+[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}[^<]*/i);
      console.log(`- ${j.jobId} (${j.title}): ${match ? match[0] : ''}`);
    }

  } catch (e) {
    console.error("Error:", e);
  } finally {
    await mongo.close();
  }
}

run();
