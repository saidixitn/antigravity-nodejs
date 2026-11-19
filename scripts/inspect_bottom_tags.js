import mongo from "../core/mongo.js";

async function inspectAllSalaryInDesc() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();

    // Look for all <p> tags at the bottom of descriptions
    const bottomTagPatterns = new Set();
    for (const j of allJobs) {
      const desc = j.description || "";
      // Match from Pay Type or Hiring or Salary till end
      const m = desc.match(/(<p><strong>(?:Pay Type|Hiring|Salary)[\s\S]*)/i);
      if (m) {
        // Normalize numbers/values to X
        const normalized = m[1]
          .replace(/\d[\d,.]*/g, "NUM")
          .replace(/>[^<]+,/g, ">LOC,"); // location
        bottomTagPatterns.add(m[1].slice(0, 200));
      }
    }

    console.log(`Found ${bottomTagPatterns.size} distinct bottom snippets.`);
    console.log("Sample snippets:");
    let count = 0;
    for (const s of bottomTagPatterns) {
      if (count++ < 15) {
        console.log(`\nSnippet ${count}:`);
        console.log(s);
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongo.close();
  }
}

inspectAllSalaryInDesc();
