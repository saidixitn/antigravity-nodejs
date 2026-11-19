import mongo from "../core/mongo.js";

async function run() {
  try {
    const root = await mongo.getRoot();
    const dbs = await root.db().admin().listDatabases();
    console.log("Databases:", dbs.databases.map(d => d.name));

    // Check prod_jobiak_ai collections
    const prodDb = await mongo.db("prod_jobiak_ai");
    const prodCols = await prodDb.listCollections().toArray();
    console.log("prod_jobiak_ai collections:", prodCols.map(c => c.name));

    // Check jobicarenode_prod collections
    const jDb = await mongo.db("jobicarenode_prod");
    const jCols = await jDb.listCollections().toArray();
    console.log("jobicarenode_prod collections:", jCols.map(c => c.name));

    // Check Target_P4_Opt in jobicarenode_prod
    const p4 = jDb.collection("Target_P4_Opt");
    const p4Job1 = await p4.findOne({ $or: [{ _id: "6ab3f2d70cb6c603f9f704e9" }, { jobId: "6ab3f2d70cb6c603f9f704e9" }] });
    console.log("P4 Job 1:", p4Job1 ? { id: p4Job1._id, jobId: p4Job1.jobId, descPrefix: p4Job1.description?.slice(0, 100) } : "None");

    const p4Job2 = await p4.findOne({ $or: [{ _id: "6ad71a24dd6a790397e93dc3" }, { jobId: "6ad71a24dd6a790397e93dc3" }] });
    console.log("P4 Job 2:", p4Job2 ? { id: p4Job2._id, jobId: p4Job2.jobId, descPrefix: p4Job2.description?.slice(0, 100) } : "None");

    const p4YesCount = await p4.countDocuments({ $or: [{ employerId: "emp-jicn-yescommunities" }, { employerId: "6a86c3d7060e8f0b78b0dc66" }] });
    console.log("P4 YES Communities total count:", p4YesCount);

  } catch (e) {
    console.error("Error:", e);
  } finally {
    await mongo.close();
  }
}

run();
