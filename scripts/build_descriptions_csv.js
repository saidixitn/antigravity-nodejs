import fs from "fs";
import path from "path";

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  // RFC 4180: double quotes inside must be replaced by two double quotes
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

function generateCsv() {
  const dataPath = path.resolve("./scripts/yes_communities_all_fixed_jobs.json");
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Data file not found at ${dataPath}`);
  }

  const jobs = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Loaded ${jobs.length} jobs to export to CSV...`);

  // Headers: JobId, Title, Status, IsActive, OriginalDescription, ModifiedDescription, OriginalSalary, ModifiedSalary, Url
  const headers = [
    "JobId",
    "Title",
    "Status",
    "IsActive",
    "OriginalDescription",
    "ModifiedDescription",
    "OriginalSalary",
    "ModifiedSalary",
    "Url"
  ];

  const rows = [headers.map(escapeCsvField).join(",")];

  for (const j of jobs) {
    const row = [
      escapeCsvField(j.jobId),
      escapeCsvField(j.title),
      escapeCsvField(j.status),
      escapeCsvField(j.isActive),
      escapeCsvField(j.description.original),
      escapeCsvField(j.description.modified),
      escapeCsvField(j.salary.original),
      escapeCsvField(j.salary.modified),
      escapeCsvField(j.url)
    ];
    rows.push(row.join(","));
  }

  const csvContent = "\uFEFF" + rows.join("\r\n"); // Add BOM for Excel compatibility with UTF-8

  const outputPath1 = path.resolve("./yes_communities_descriptions.csv");
  fs.writeFileSync(outputPath1, csvContent, "utf8");
  console.log(`Generated root CSV: ${outputPath1} (${(fs.statSync(outputPath1).size / (1024 * 1024)).toFixed(2)} MB)`);

  const outputPath2 = path.resolve("./scripts/yes_communities_descriptions.csv");
  fs.writeFileSync(outputPath2, csvContent, "utf8");
  console.log(`Generated scripts CSV: ${outputPath2}`);
}

generateCsv();
