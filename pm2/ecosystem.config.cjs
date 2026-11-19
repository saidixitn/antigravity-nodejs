/**
 * ecosystem.config.cjs - PM2 Production Process Configuration
 * ===========================================================
 * Manages the REST API microservice and scheduled daily pipeline.
 */

module.exports = {
  apps: [
    {
      name: "jobiak-api",
      script: "./cli.js",
      args: "serve",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "proxy-daily-pipeline",
      script: "./cli.js",
      args: "pipeline",
      instances: 1,
      autorestart: false,
      cron_restart: "0 9 * * *", // 09:00 AM IST daily
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
