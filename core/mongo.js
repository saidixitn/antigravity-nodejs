/**
 * mongo.js - Dynamic Multi-Tenant MongoDB Engine
 * ===============================================
 * Auto-resolves cluster connection strings from mongo_creds.creds on the central
 * hub, maintains high-performance connection pools, and tracks latency health.
 */

import { MongoClient } from "mongodb";
import { env } from "./auth.js";
import logger from "./logger.js";

class MongoEngine {
  constructor() {
    this.pools = new Map();     // URI -> MongoClient
    this.dbMap = new Map();     // dbName -> Db
    this.rootClient = null;
    this.latencyMap = new Map(); // dbName -> ping ms
  }

  /**
   * Connects to the Central Mongo Hub via MONGO_URI
   */
  async getRoot() {
    if (this.rootClient) return this.rootClient;

    if (!env.mongoUri) {
      throw new Error("MONGO_URI is missing from environment.");
    }

    try {
      const client = new MongoClient(env.mongoUri, {
        maxPoolSize: env.maxPoolSize,
        minPoolSize: env.minPoolSize,
        connectTimeoutMS: 20000,
        socketTimeoutMS: 45000,
      });

      await client.connect();
      await client.db("admin").command({ ping: 1 });
      this.rootClient = client;
      this.pools.set("ROOT", client);
      logger.success("Connected to Central Mongo Hub");
      return this.rootClient;
    } catch (err) {
      logger.error("Could not connect to Central Mongo Hub", err);
      throw err;
    }
  }

  /**
   * Resolves database handle dynamically with connection pooling
   */
  async db(dbName) {
    if (this.dbMap.has(dbName)) {
      return this.dbMap.get(dbName);
    }

    const root = await this.getRoot();

    // Databases hosted directly on the central hub
    const hubDbs = [
      "mongo_creds", "google_creds", "daily_stats", "daily_domain_stats",
      "Clicks_Report", "domain_expires", "domain_postings", "xml_timings",
      "banana_analytics", "GenAI", "GSC", "surveys_prod", "XML", "dc_prod", "proxy_stats"
    ];

    if (hubDbs.includes(dbName)) {
      const database = root.db(dbName);
      this.dbMap.set(dbName, database);
      return database;
    }

    // Dynamic routing lookup in mongo_creds.creds
    const credsCol = root.db("mongo_creds").collection("creds");
    const credDoc = await credsCol.findOne({ domain: dbName });

    if (!credDoc) {
      logger.warn(`No credential record for '${dbName}' in mongo_creds.creds; falling back to root hub.`);
      const fallback = root.db(dbName);
      this.dbMap.set(dbName, fallback);
      return fallback;
    }

    const uri = credDoc.mongo_uri || credDoc.uri;
    if (!uri) {
      throw new Error(`Credential document for '${dbName}' lacks 'mongo_uri' or 'uri'.`);
    }

    // Reuse existing pool if another DB shares this cluster URI
    if (this.pools.has(uri)) {
      const client = this.pools.get(uri);
      const database = client.db(dbName);
      this.dbMap.set(dbName, database);
      return database;
    }

    // Establish new pool for target cluster
    try {
      const client = new MongoClient(uri, {
        maxPoolSize: env.maxPoolSize,
        minPoolSize: env.minPoolSize,
        connectTimeoutMS: 20000,
        socketTimeoutMS: 45000,
      });

      const start = Date.now();
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      const latency = Date.now() - start;

      this.pools.set(uri, client);
      this.latencyMap.set(dbName, latency);

      const database = client.db(dbName);
      this.dbMap.set(dbName, database);
      logger.info(`Pool established for '${dbName}'`, `${latency}ms latency`);
      return database;
    } catch (err) {
      logger.error(`Cluster connection failed for '${dbName}'`, err);
      throw err;
    }
  }

  /**
   * One-liner to get a collection from any database
   */
  async col(dbName, colName) {
    const database = await this.db(dbName);
    return database.collection(colName);
  }

  /**
   * Measures ping latency in milliseconds
   */
  async ping(dbName) {
    const start = Date.now();
    const database = await this.db(dbName);
    await database.command({ ping: 1 });
    const latency = Date.now() - start;
    this.latencyMap.set(dbName, latency);
    return latency;
  }

  /**
   * Lists all available tenant databases registered on the hub
   */
  async listClients() {
    const root = await this.getRoot();
    const credsCol = root.db("mongo_creds").collection("creds");
    return credsCol
      .find({}, { projection: { domain: 1, ping_latency_ms: 1, last_checked: 1, _id: 0 } })
      .sort({ domain: 1 })
      .toArray();
  }

  /**
   * Closes all connection pools gracefully
   */
  async close() {
    for (const [key, client] of this.pools.entries()) {
      try {
        await client.close();
      } catch (e) {
        // ignore
      }
    }
    this.pools.clear();
    this.dbMap.clear();
    this.rootClient = null;
    logger.info("Connection pools closed cleanly");
  }
}

export const mongo = new MongoEngine();
export default mongo;
