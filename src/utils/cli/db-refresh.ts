/**
 * DATABASE REFRESH UTILITY
 * ------------------------
 * Triggers the local Astro server to clear its in-memory cache.
 * 
 * USAGE:
 * npm run db:refresh
 */

import dotenv from "dotenv";
import { logger } from "@stimsdesign/core/logger";

dotenv.config();

// Determine the local server URL. 
// Default to localhost:4321 if not specified.
const BASE_URL = process.env.ASTRO_URL || "http://localhost:4321";
const SECRET = process.env.STIMSDESIGN_SECRET_KEY;

if (!SECRET) {
    logger.error("❌ Error: STIMSDESIGN_SECRET_KEY environment variable is not set.");
    process.exit(1);
}

async function clearCache() {
    logger.log("🔄 Triggering cache clear on running server...");

    try {
        const response = await fetch(`${BASE_URL}/api/dev/clear-cache`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: SECRET })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Server responded with ${response.status}: ${text}`);
        }

        const data = await response.json();
        logger.log(`✅ ${data.message}`);
    } catch (error: any) {
        if (error.cause && error.cause.code === 'ECONNREFUSED') {
            logger.error("❌ Error: Could not connect to the server.");
            logger.error("   Make sure 'npm run dev' is running on http://localhost:4321");
        } else {
            logger.error("❌ Error clearing cache:", error.message);
        }
        process.exit(1);
    }
}

clearCache();
