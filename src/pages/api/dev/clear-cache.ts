import type { APIRoute } from 'astro';
import { clearAllCache } from "@stimsdesign/core/db";
import { logger } from "@stimsdesign/core/logger";

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
    let key = url.searchParams.get("key");
    if (!key) {
        try { 
            const body = await request.clone().json(); 
            key = body.key; 
        } catch(e) {}
    }
    const secret = import.meta.env.STIMSDESIGN_SECRET_KEY;
    logger.log(`[DEBUG] Cache clear requested. Key: "${key}", Secret: "${secret}"`);

    if (!secret || key !== secret) {
        logger.warn(`[SECURITY] Cache clear failed: Key mismatch or secret not set.`);
        return new Response(null, { status: 404 });
    }

    // Basic protection: Only allow in development mode
    if (process.env.NODE_ENV === 'production') {
        return new Response(JSON.stringify({ error: "Not allowed in production" }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        clearAllCache();
        logger.log("🧹 Cache cleared via API request.");
        return new Response(JSON.stringify({ success: true, message: "Cache cleared successfully" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
};
