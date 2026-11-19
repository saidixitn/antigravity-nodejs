/**
 * auth.js - Universal Authentication & Secure Environment Loader
 * ==============================================================
 * Centralizes all environment configuration and Google credentials.
 * NEVER hardcodes IPs, emails, spreadsheet IDs, or employer IDs.
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { google } from "googleapis";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Load environment variables
dotenv.config({ path: path.join(rootDir, ".env") });

export const env = {
  // MongoDB Connection
  mongoUri: process.env.MONGO_URI,
  maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || "50", 10),
  minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || "5", 10),

  // Google Service Account & Spreadsheets (strictly from .env)
  googleCredPath: path.resolve(
    rootDir,
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_CREDENTIALS ||
      "credentials.json"
  ),
  spreadsheetId: process.env.SPREADSHEET_ID,
  updatesSpreadsheetId: process.env.UPDATES_SPREADSHEET_ID || process.env.SPREADSHEET_ID,
  expiresSpreadsheetId: process.env.EXPIRES_SPREADSHEET_ID || process.env.SPREADSHEET_ID,

  // Server & APIs
  port: parseInt(process.env.PORT || "4000", 10),
  logLevel: process.env.LOG_LEVEL || "info",

  // Alerts & Notifications (strictly from .env)
  smtp: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    sender: process.env.SMTP_SENDER || process.env.SMTP_USER,
    receiver: process.env.SMTP_RECEIVER,
    cc: process.env.SMTP_CC,
  },
};

/**
 * Returns an authenticated Google Sheets v4 API instance
 */
let googleAuthClient = null;
let sheetsApiInstance = null;

export async function getGoogleSheets() {
  if (sheetsApiInstance) return sheetsApiInstance;

  if (!fs.existsSync(env.googleCredPath)) {
    throw new Error(`Google credentials file not found: ${env.googleCredPath}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: env.googleCredPath,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });

  googleAuthClient = await auth.getClient();
  sheetsApiInstance = google.sheets({ version: "v4", auth: googleAuthClient });
  return sheetsApiInstance;
}

/**
 * Safely loads client configurations from gitignored clients.json
 */
export function loadClientsConfig() {
  const clientsFile = path.join(rootDir, "clients.json");
  if (fs.existsSync(clientsFile)) {
    try {
      const data = fs.readFileSync(clientsFile, "utf-8");
      return JSON.parse(data);
    } catch (e) {
      console.warn("Could not parse clients.json:", e.message);
    }
  }
  return [];
}

/**
 * Verifies core configuration integrity
 */
export function verifyConfig() {
  const issues = [];
  if (!env.mongoUri) issues.push("MONGO_URI is missing from .env");
  if (!fs.existsSync(env.googleCredPath)) issues.push(`credentials.json not found at ${env.googleCredPath}`);
  return { valid: issues.length === 0, issues };
}

export default { env, getGoogleSheets, loadClientsConfig, verifyConfig };
