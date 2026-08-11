import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Provision a Postgres database and set it in .env");
}

// A generous connectionTimeoutMillis (pg's default is 0 = wait forever)
// means a slow-to-respond free-tier Postgres instance gets a bounded wait
// instead of a query hanging with no clear failure signal either way.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
export const db = drizzle(pool, { schema });
