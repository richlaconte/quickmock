// Applies db/schema.sql. Run by `npm run db:migrate`, and before every build on Vercel.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // No such file: the variables come from the environment.
  }
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add a Postgres database (see README) or put DATABASE_URL in .env.local.");
  process.exit(1);
}

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../db/schema.sql"), "utf8");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? undefined : true });
await client.connect();
await client.query(schema);
await client.end();
console.log("Database schema is up to date.");
