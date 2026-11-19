import mongo from "../core/mongo.js";

async function inspectSafetyDisclaimer() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();
    console.log(`Checking safety disclaimer across all ${allJobs.length} jobs...`);

    const rxSafety = /<p>\s*Your safety matters to us[\s\S]*?visit yescommunities\.com\/careers\/? directly for confirmed position openings\.?\s*<\/p>/gi;
    const rxSafetyAny = /Your safety matters to us[\s\S]*?visit yescommunities\.com\/careers\/? directly for confirmed position openings\.?/gi;

    let matchP = 0;
    let matchAny = 0;
    const variants = new Set();

    for (const j of allJobs) {
      const desc = j.description || "";
      if (rxSafety.test(desc)) {
        matchP++;
      }
      rxSafety.lastIndex = 0;

      const m = desc.match(rxSafetyAny);
      if (m) {
        matchAny++;
        variants.add(m[0]);
      }
    }

    console.log(`Jobs matching with <p>...</p>: ${matchP}`);
    console.log(`Jobs matching any form: ${matchAny}`);
    console.log(`Unique variants found: ${variants.size}`);
    for (const v of variants) {
      console.log("\nVariant snippet:\n", v.slice(0, 150), "...", v.slice(-80));
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongo.close();
  }
}

inspectSafetyDisclaimer();
