/**
 * logger.js - High-Performance ANSI Terminal Logger
 * =================================================
 * Clean, production-grade terminal output with timestamp, level badges,
 * and zero PID/JSON clutter.
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

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const logger = {
  info(msg, meta = "") {
    const metaStr = meta ? ` ${colors.dim}${typeof meta === "object" ? JSON.stringify(meta) : meta}${colors.reset}` : "";
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.cyan}[INFO]${colors.reset}    ${msg}${metaStr}`);
  },

  success(msg, meta = "") {
    const metaStr = meta ? ` ${colors.dim}${typeof meta === "object" ? JSON.stringify(meta) : meta}${colors.reset}` : "";
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.green}[SUCCESS]${colors.reset} ${msg}${metaStr}`);
  },

  warn(msg, meta = "") {
    const metaStr = meta ? ` ${colors.dim}${typeof meta === "object" ? JSON.stringify(meta) : meta}${colors.reset}` : "";
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}[WARN]${colors.reset}   ${msg}${metaStr}`);
  },

  error(msg, err = "") {
    const errStr = err ? `\n${colors.red}${err.stack || err.message || err}${colors.reset}` : "";
    console.error(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}[ERROR]${colors.reset}  ${msg}${errStr}`);
  },

  section(title) {
    console.log(`\n${colors.bold}${colors.cyan}=== ${title.toUpperCase()} ===${colors.reset}`);
  },

  table(data) {
    console.table(data);
  },
};

export default logger;
