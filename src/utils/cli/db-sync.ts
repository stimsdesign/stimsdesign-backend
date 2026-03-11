/**
 * DATABASE SYNC & CLEANUP UTILITY
 * ------------------------------
 * This is a LOCAL-ONLY utility script used to synchronize modular database schemas
 * with the Neon PostgreSQL database.
 * 
 * FEATURES:
 * - Aggregates declarative 'moduleSchema' definitions from 'src/modules/[module]/schema.ts'.
 * - Automatically creates/updates tables and columns.
 * - Provides 'Declarative Cleanup': Automatically drops columns that are no longer 
 *   defined in any module's schema.
 * - Protection: Core Better Auth and plugin-critical columns are hard-coded into 
 *   a protection list to prevent accidental data loss.
 * 
 * USAGE:
 * npm run db:sync
 * 
 * NOTE: This tool is for LOCAL DEVELOPMENT and is excluded from the production 
 * bundle by Astro's build engine (since it's not imported by any pages).
 */

import { Pool as NeonPool } from "@neondatabase/serverless";
import pg from "pg";
import dotenv from "dotenv";
import { runSync } from "../db-init";
import { logger } from "@stimsdesign/core/logger";

// Load environment variables
dotenv.config();

const databaseUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
    logger.error("❌ Error: DATABASE_URL or NETLIFY_DATABASE_URL environment variable is not set.");
    process.exit(1);
}

const isNeon = databaseUrl.includes("neon.tech");
const pool = isNeon 
    ? new NeonPool({ connectionString: databaseUrl }) 
    : new pg.Pool({ connectionString: databaseUrl });

async function run() {
    try {
        await runSync(pool, true); // CLI sync is destructive (drops orphaned columns)
    } catch (err) {
        logger.error("❌ Fatal Error during sync:", err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
