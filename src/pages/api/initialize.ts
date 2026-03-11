export const prerender = false;
/**
 * Database Initialization Endpoint
 * ------------------------------
 * This endpoint triggers the automatic discovery and synchronization of all modules 
 * located in 'src/modules'. 
 * 
 * It returns a JSON object listing each detected module and its initialization status.
 * 
 * REQUIRED MODULES:
 * - users
 * - my-account
 * - dashboard
 * 
 * These must be initialized for the main application (/portal, /dashboard) to be accessible.
 */
import type { APIRoute } from 'astro';
import { ensureDbInitialized } from '../../utils/db-init';
import { logger } from "@stimsdesign/core/logger";

export const GET: APIRoute = async ({ url }) => {
    const key = url.searchParams.get("key");
    const secret = process.env.STIMSDESIGN_SECRET_KEY;

    // Security: Only allow initialization if a secret key is provided and matches.
    // If no secret is configured in .env, we strictly disallow web-based init for safety.
    if (!secret || key !== secret) {
        return new Response(null, { status: 404 });
    }

    try {
        // Trigger the unified sync process
        const moduleResults = await ensureDbInitialized();

        return new Response(JSON.stringify(moduleResults), {
            headers: { 'content-type': 'application/json' },
        });
    } catch (e: any) {
        logger.error("Initialization error:", e);
        return new Response(JSON.stringify({ 
            error: "Initialization failed", 
            details: e.message 
        }), { 
            status: 500,
            headers: { 'content-type': 'application/json' }
        });
    }
};
