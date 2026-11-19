import mongo from "../core/mongo.js";

async function run() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const totalCount = await jobCol.countDocuments({ employerId: empId });
    console.log("Total YES Communities jobs in prod_jobiak_ai:", totalCount);

    const activeCount = await jobCol.countDocuments({ employerId: empId, status: "posted", isActive: true });
    console.log("Active posted jobs:", activeCount);

    const postedAnyActive = await jobCol.countDocuments({ employerId: empId, status: "posted" });
    console.log("Status 'posted' jobs:", postedAnyActive);

    const isActiveTrue = await jobCol.countDocuments({ employerId: empId, isActive: true });
    console.log("isActive true jobs:", isActiveTrue);

    // Let's inspect the two specific jobs
    const id1 = "6ab3f2d70cb6c603f9f704e9";
    const id2 = "6ad71a24dd6a790397e93dc3";
    const j1 = await jobCol.findOne({ $or: [{ jobId: id1 }, { _id: id1 }] });
    const j2 = await jobCol.findOne({ $or: [{ jobId: id2 }, { _id: id2 }] });

    console.log("Job 1 status/isActive:", { status: j1?.status, isActive: j1?.isActive });
    console.log("Job 2 status/isActive:", { status: j2?.status, isActive: j2?.isActive });

    // Now let's check for the issues across ALL YES Communities jobs in prod_jobiak_ai:
    // 1. "Posted <Day>, <Month> <Date>, <Year>, <Time>" at the start or anywhere in description
    // 2. "$X - $X per year" or "Hiring Min Rate" == "Hiring Max Rate" or salary pattern in description
    // 3. Location at the end of the description (e.g. after </p> or at the tail)
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await mongo.close();
  }
}

run();
