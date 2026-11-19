import mongo from "../core/mongo.js";

async function checkDescDetails() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    // 1. Look for jobs with 50,000 or 50000 in description
    const jobsWith50kInDesc = await jobCol.find({
      employerId: empId,
      description: { $regex: /50[,.]?000/i }
    }).project({ jobId: 1, title: 1, salary: 1, description: 1 }).toArray();

    console.log(`Jobs with 50,000 or 50000 in description: ${jobsWith50kInDesc.length}`);
    for (const j of jobsWith50kInDesc) {
      console.log(`\nJobId: ${j.jobId} | Title: ${j.title} | SalaryField: ${j.salary}`);
      // Find the snippet around 50,000
      const idx = j.description.search(/50[,.]?000/i);
      console.log("Snippet:", JSON.stringify(j.description.substring(Math.max(0, idx - 100), Math.min(j.description.length, idx + 200))));
    }

    // 2. How many jobs have Pay Type or Hiring Min Rate or Hiring Max Rate in description?
    const jobsWithHiringRate = await jobCol.find({
      employerId: empId,
      description: { $regex: /Hiring\s+Min\s+Rate/i }
    }).project({ jobId: 1, title: 1, salary: 1, description: 1 }).toArray();

    console.log(`\nTotal jobs with 'Hiring Min Rate' in description: ${jobsWithHiringRate.length}`);

    // Let's sample a few different titles with Hiring Min Rate
    const byTitle = {};
    for (const j of jobsWithHiringRate) {
      if (!byTitle[j.title]) byTitle[j.title] = [];
      byTitle[j.title].push(j);
    }
    console.log("Titles with Hiring Min Rate:", Object.keys(byTitle).map(t => `${t} (${byTitle[t].length})`));

    // For each title, show the salary snippet at the end of the description
    for (const [title, list] of Object.entries(byTitle)) {
      const sample = list[0];
      const match = sample.description.match(/(?:<p><strong>Pay Type:[\s\S]*)/i);
      console.log(`\n[${title}] snippet (${sample.jobId}):`, match ? match[0] : "no match");
    }

  } catch (e) {
    console.error(e);
  } finally {
    await mongo.close();
  }
}

checkDescDetails();
