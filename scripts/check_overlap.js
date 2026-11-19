import mongo from "../core/mongo.js";

async function checkOverlap() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();

    const rxRateTags = /<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/i;

    const equalInDesc = [];
    for (const j of allJobs) {
      const desc = j.description || "";
      const m = desc.match(rxRateTags);
      if (m && m[1].trim() === m[2].trim()) {
        equalInDesc.push({
          jobId: j.jobId,
          title: j.title,
          rateDesc: m[0],
          rateVal: m[1].trim(),
          salaryField: j.salary,
          status: j.status,
          isActive: j.isActive
        });
      }
    }

    console.log(`Equal Min/Max Rate in description: ${equalInDesc.length} jobs`);
    const byRateVal = {};
    for (const j of equalInDesc) {
      byRateVal[j.rateVal] = (byRateVal[j.rateVal] || 0) + 1;
    }
    console.log("By rate value in description:", byRateVal);
    console.log("Sample records:", equalInDesc.slice(0, 5));

  } catch (e) {
    console.error(e);
  } finally {
    await mongo.close();
  }
}

checkOverlap();
