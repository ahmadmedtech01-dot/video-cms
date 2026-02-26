import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

if (process.env.SUPABASE_DATABASE_URL) {
  console.log("[db] Using Supabase database");
} else {
  console.log("[db] Using Replit database (SUPABASE_DATABASE_URL not set)");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.SUPABASE_DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
export { pool };
