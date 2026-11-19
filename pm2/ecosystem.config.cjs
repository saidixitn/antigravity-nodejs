/**
 * ecosystem.config.cjs - PM2 Enterprise Production Process Configuration
 * =====================================================================
 * Manages the high-performance REST API microservice and scheduled automated
 * operational cron jobs across all multi-tenant MongoDB clusters.
 */

module.exports = {
  apps: [
    // 1. High-Performance REST API Microservice (Always Online)
    {
      name: "jobiak-api",
      script: "./cli.js",
      args: "serve",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
    },

    // 2. Daily Proxy Pipeline (Updates -> Expires)
    // Runs at 09:00 AM IST daily (03:30 AM UTC)
    {
      name: "daily-proxy-pipeline",
      script: "./cli.js",
      args: "pipeline",
      instances: 1,
      autorestart: false,
      cron_restart: "30 3 * * *",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },

    // 3. GPD Description Hygiene & Schema Audit
    // Runs at 10:00 AM IST daily (04:30 AM UTC)
    {
      name: "gpd-quality-audit",
      script: "./cli.js",
      args: "gpd audit",
      instances: 1,
      autorestart: false,
      cron_restart: "30 4 * * *",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },

    // 4. Pre-Posting Ingestion Collision Gate
    // Runs at 11:00 AM IST daily (05:30 AM UTC)
    {
      name: "ingestion-collision-gate",
      script: "./cli.js",
      args: "collision",
      instances: 1,
      autorestart: false,
      cron_restart: "30 5 * * *",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },

    // 5. Monthly Unique Views Billing Report
    // Runs on the 1st day of every month at 08:00 AM IST (02:30 AM UTC)
    {
      name: "monthly-views-report",
      script: "./cli.js",
      args: "views --lead tarun",
      instances: 1,
      autorestart: false,
      cron_restart: "30 2 1 * *",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
