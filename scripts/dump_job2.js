import mongo from "../core/mongo.js";

async function dumpJob2() {
  try {
    const db = await mongo.db("prod_jobiak_ai");
    const j = await db.collection("job").findOne({ jobId: "6ad71a24dd6a790397e93dc3" });
    console.log("Full job 2 document:\n", JSON.stringify(j, null, 2));
  } finally {
    await mongo.close();
  }
}
dumpJob2();
