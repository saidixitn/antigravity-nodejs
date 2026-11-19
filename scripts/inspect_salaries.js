import mongo from "../core/mongo.js";

async function inspectSalaries() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const jobCol = db.collection("job");
    const empId = "6a86c3d7060e8f0b78b0dc66";

    const allJobs = await jobCol.find({ employerId: empId }).toArray();

    // Check all salary field values
    const salaryFieldValues = new Map();
    const duplicateSalaryFieldJobs = [];

    for (const j of allJobs) {
      if (j.salary) {
        salaryFieldValues.set(j.salary, (salaryFieldValues.get(j.salary) || 0) + 1);

        // Check if salary field has pattern like $X - $X
        // e.g., $50000 - $50000 Per Year or $18 - $18 or similar
        const m = j.salary.match(/\$?(\d[\d,.]*)\s*(?:USD)?\s*-\s*\$?(\d[\d,.]*)\s*(?:USD)?\s*(.*)/i);
        if (m) {
          const num1 = m[1].replace(/,/g, '');
          const num2 = m[2].replace(/,/g, '');
          if (parseFloat(num1) === parseFloat(num2)) {
            duplicateSalaryFieldJobs.push({
              jobId: j.jobId,
              title: j.title,
              rawSalary: j.salary,
              period: m[3]?.trim(),
              status: j.status,
              isActive: j.isActive
            });
          }
        }
      }
    }

    console.log("Unique salary field values found across all YES jobs:");
    for (const [val, count] of salaryFieldValues.entries()) {
      console.log(`- "${val}": ${count} jobs`);
    }

    console.log(`\nTotal jobs with identical salary min-max in 'salary' field: ${duplicateSalaryFieldJobs.length}`);
    console.log("Sample identical salary field jobs:", duplicateSalaryFieldJobs.slice(0, 10));

    // Also check if salary is anywhere in the description text itself (apart from Hiring Min Rate / Max Rate)
    const salaryInDesc = [];
    for (const j of allJobs) {
      const desc = j.description || "";
      if (desc.includes("per year") || desc.includes("Per Year") || desc.includes("per hour") || desc.includes("Per Hour")) {
        salaryInDesc.push({ jobId: j.jobId, title: j.title });
      }
    }
    console.log(`\nJobs with 'per year' / 'per hour' inside description text: ${salaryInDesc.length}`);

    // Check if Hiring Min Rate == Hiring Max Rate in description
    // e.g. <p><strong>Hiring Min Rate:</strong> 50,000 USD</p><p><strong>Hiring Max Rate:</strong> 50,000 USD</p>
    const equalRateInDesc = [];
    const rxRateTags = /<p><strong>Hiring Min Rate:<\/strong>\s*([^<]+)<\/p>\s*<p><strong>Hiring Max Rate:<\/strong>\s*([^<]+)<\/p>/i;
    for (const j of allJobs) {
      const desc = j.description || "";
      const m = desc.match(rxRateTags);
      if (m) {
        const min = m[1].trim();
        const max = m[2].trim();
        if (min === max) {
          equalRateInDesc.push({
            jobId: j.jobId,
            title: j.title,
            snippet: m[0],
            min,
            max
          });
        }
      }
    }
    console.log(`Jobs with equal Hiring Min/Max Rate in description: ${equalRateInDesc.length}`);
    console.log("Sample equal rate in desc:", equalRateInDesc.slice(0, 5));

  } catch (err) {
    console.error(err);
  } finally {
    await mongo.close();
  }
}

inspectSalaries();
