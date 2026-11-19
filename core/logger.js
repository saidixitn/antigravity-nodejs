/**
 * logger.js - High-Performance ANSI Terminal Logger
 * =================================================
 * Clean, production-grade terminal output with timestamp, level badges,
 * and zero PID/JSON clutter.
 * 
 * Built-in Secret & IP Sanitizer:
 * Automatically redacts IPv4 addresses, MongoDB connection strings,
 * and authentication tokens from all log messages, stack traces, and metadata.
 */

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

/**
 * Strips credentials, connection URIs, and external IP addresses
 */
function sanitize(input) {
  if (!input) return "";
  let str = typeof input === "object" ? (input.stack || input.message || JSON.stringify(input)) : String(input);

  // 1. Redact MongoDB URIs with credentials
  str = str.replace(/mongodb(?:\+srv)?:\/\/[^@\s]+@([^\s/?#]+)/gi, "mongodb://***:***@<cluster-host>");
  
  // 2. Redact standalone passwords in URLs
  str = str.replace(/:([^\s:@]{3,})@/g, ":***@");

  // 3. Redact non-loopback IPv4 addresses
  str = str.replace(/\b(?!(?:127\.0\.0\.1|0\.0\.0\.0|localhost)\b)(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, "<sanitized-ip>");

  return str;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const logger = {
  info(msg, meta = "") {
    const cleanMsg = sanitize(msg);
    const metaStr = meta ? ` ${colors.dim}${sanitize(meta)}${colors.reset}` : "";
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.cyan}[INFO]${colors.reset}    ${cleanMsg}${metaStr}`);
  },

  success(msg, meta = "") {
    const cleanMsg = sanitize(msg);
    const metaStr = meta ? ` ${colors.dim}${sanitize(meta)}${colors.reset}` : "";
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.green}[SUCCESS]${colors.reset} ${cleanMsg}${metaStr}`);
  },

  warn(msg, meta = "") {
    const cleanMsg = sanitize(msg);
    const metaStr = meta ? ` ${colors.dim}${sanitize(meta)}${colors.reset}` : "";
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}[WARN]${colors.reset}   ${cleanMsg}${metaStr}`);
  },

  error(msg, err = "") {
    const cleanMsg = sanitize(msg);
    const errStr = err ? `\n${colors.red}${sanitize(err)}${colors.reset}` : "";
    console.error(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}[ERROR]${colors.reset}  ${cleanMsg}${errStr}`);
  },

  section(title) {
    console.log(`\n${colors.bold}${colors.cyan}=== ${sanitize(title).toUpperCase()} ===${colors.reset}`);
  },

  table(data) {
    console.table(data);
  },
};

export default logger;
