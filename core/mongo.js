/**
 * mongo.js - Dynamic Multi-Tenant MongoDB Engine (Local + Remote)
 * ==============================================================
 * Connects to:
 * 1. Localhost MongoDB (127.0.0.1:27017) by default for fast, zero-load local operations.
 * 2. Remote VPS Clusters dynamically via URI discovery in mongo_creds.creds (NO hardcoded IPs).
 * 3. Connection pools are cached in memory to eliminate socket leaks and CPU load.
 */

import { MongoClient } from "mongodb";
import { env } from "./auth.js";
import logger from "./logger.js";

const LOCAL_URI = process.env.LOCAL_MONGO_URI || "mongodb://127.0.0.1:27017";

class MongoEngine {
  constructor() {
    this.pools = new Map();     // URI -> MongoClient
    this.dbMap = new Map();     // cacheKey -> Db
    this.localClient = null;
    this.rootClient = null;
    this.latencyMap = new Map(); // dbName -> ping ms
  }

  /**
   * Fast connection to Localhost MongoDB (127.0.0.1:27017)
   */
  async getLocal() {
    if (this.localClient) return this.localClient;

    try {
      const client = new MongoClient(LOCAL_URI, {
        maxPoolSize: 20,
        minPoolSize: 1,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 15000,
      });

      await client.connect();
      this.localClient = client;
      this.pools.set("LOCAL", client);
      return this.localClient;
    } catch (err) {
      logger.warn(`Local MongoDB not accessible on ${LOCAL_URI}: ${err.message}`);
      return null;
    }
  }

  /**
   * Get direct handle to a local database on 127.0.0.1:27017
   */
  async localDb(dbName) {
    const local = await this.getLocal();
    if (!local) throw new Error(`Cannot connect to local MongoDB on ${LOCAL_URI}`);
    return local.db(dbName);
  }

  /**
   * Connects to Central Mongo Hub (Remote / Root)
   */
  async getRoot() {
    if (this.rootClient) return this.rootClient;

    if (!env.mongoUri) {
      throw new Error("MONGO_URI is missing from environment (.env).");
    }

    try {
      const client = new MongoClient(env.mongoUri, {
        maxPoolSize: env.maxPoolSize || 10,
        minPoolSize: env.minPoolSize || 1,
        connectTimeoutMS: 15000,
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
   * Dynamic URI Resolver from mongo_creds.creds (NO hardcoded IPs!)
   */
  async getUri(domainName) {
    // 1. Check local mongo_creds first (if local mongo is running)
    try {
      const local = await this.getLocal();
      if (local) {
        const doc = await local.db("mongo_creds").collection("creds").findOne({ domain: domainName });
        if (doc && (doc.mongo_uri || doc.uri)) return doc.mongo_uri || doc.uri;
      }
    } catch {
      // Ignore and proceed to root
    }

    // 2. Query Central Mongo Hub mongo_creds.creds
    const root = await this.getRoot();
    const credsCol = root.db("mongo_creds").collection("creds");
    const doc = await credsCol.findOne({ domain: domainName });
    if (doc && (doc.mongo_uri || doc.uri)) {
      return doc.mongo_uri || doc.uri;
    }

    return null;
  }

  /**
   * Resolves a database handle with automatic pooling and caching
   * @param {string} dbName
   * @param {object} options { preferLocal: boolean }
   */
  async db(dbName, options = {}) {
    const cacheKey = `${options.preferLocal ? "LOCAL:" : "REMOTE:"}${dbName}`;
    if (this.dbMap.has(cacheKey)) {
      return this.dbMap.get(cacheKey);
    }

    // If preferLocal or LOCAL_DOMAIN_MONGOS is true, check local MongoDB
    if (options.preferLocal || process.env.LOCAL_DOMAIN_MONGOS === "true") {
      const local = await this.getLocal();
      if (local) {
        const database = local.db(dbName);
        this.dbMap.set(cacheKey, database);
        return database;
      }
    }

    // Central hub hosted databases
    const hubDbs = [
      "mongo_creds", "google_creds", "daily_stats", "daily_domain_stats",
      "Clicks_Report", "domain_expires", "domain_postings", "xml_timings",
      "banana_analytics", "GenAI", "GSC", "surveys_prod", "XML", "dc_prod", "proxy_stats"
    ];

    const root = await this.getRoot();

    if (hubDbs.includes(dbName)) {
      const database = root.db(dbName);
      this.dbMap.set(cacheKey, database);
      return database;
    }

    // Dynamic routing lookup in mongo_creds.creds
    const targetUri = await this.getUri(dbName);
    if (!targetUri) {
      logger.warn(`No credential record for '${dbName}' in mongo_creds.creds; falling back to root hub.`);
      const fallback = root.db(dbName);
      this.dbMap.set(cacheKey, fallback);
      return fallback;
    }

    // Reuse existing pool if another DB shares this cluster URI
    if (this.pools.has(targetUri)) {
      const client = this.pools.get(targetUri);
      const database = client.db(dbName);
      this.dbMap.set(cacheKey, database);
      return database;
    }

    // Establish new cached pool for target cluster
    try {
      const client = new MongoClient(targetUri, {
        maxPoolSize: env.maxPoolSize || 10,
        minPoolSize: env.minPoolSize || 1,
        connectTimeoutMS: 15000,
        socketTimeoutMS: 45000,
      });

      const start = Date.now();
      await client.connect();
      const latency = Date.now() - start;

      this.pools.set(targetUri, client);
      this.latencyMap.set(dbName, latency);

      const database = client.db(dbName);
      this.dbMap.set(cacheKey, database);
      logger.info(`Pool established for '${dbName}'`, `${latency}ms latency`);
      return database;
    } catch (err) {
      logger.error(`Cluster connection failed for '${dbName}'`, err);
      throw err;
    }
  }

  /**
   * Ping database cluster latency
   */
  async ping(dbName) {
    const targetDb = await this.db(dbName);
    const start = Date.now();
    await targetDb.command({ ping: 1 });
    return Date.now() - start;
  }

  /**
   * Graceful cleanup of all open client pools
   */
  async close() {
    for (const [key, client] of this.pools.entries()) {
      try {
        await client.close();
      } catch {
        // Ignore
      }
    }
    this.pools.clear();
    this.dbMap.clear();
    this.rootClient = null;
    this.localClient = null;
    logger.info("Connection pools closed cleanly");
  }
}

const mongo = new MongoEngine();

process.on("SIGINT", async () => {
  await mongo.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await mongo.close();
  process.exit(0);
});

export default mongo;
