/**
 * Astro Middleware
 * intercepts requests to provide global functionality like authentication checks and logging.
 * https://docs.astro.build/en/guides/middleware/
 *
 * Related files (Authentication):
 *   - src/utils/auth.ts
 *   - src/utils/auth-client.ts
 *   - src/pages/api/auth/[...all].ts
 *   - src/middleware.ts
 *   - src/env.d.ts
 */

import { defineMiddleware } from "astro:middleware";
import { Auth } from "./utils/auth";
import { checkRequiredModulesInitialized } from "@stimsdesign/core/db";
import { logger } from "@stimsdesign/core/logger";

export const onRequest = defineMiddleware(async (context, next) => {
    const path = context.url.pathname;
    
    // Routes that require server-side session data (SSR)
    const ssrRoutes = [
        "/portal",
        "/dashboard",
    ];

    // Check if the current path starts with any of the SSR routes
    const isSSRRoute = ssrRoutes.some(route => path.startsWith(route));

    if (isSSRRoute) {
        if (import.meta.env.ENABLE_MAINTENANCE_MODE === "TRUE") {
            logger.info("Maintenance mode enabled. Redirecting to 503.");
            return context.redirect("/503");
        }

        try {
            // Check if database is connected and core modules are initialized
            const dbStatus = await checkRequiredModulesInitialized();
            
            if (!dbStatus.ok) {
                logger.warn(`Database status check failed: ${dbStatus.error}. Redirecting to 503.`);
                return context.redirect("/503");
            }

            const isAuthed = await Auth.api.getSession({
                headers: context.request.headers,
            });
            
            if (isAuthed) {
                context.locals.user = isAuthed.user;
                context.locals.session = isAuthed.session;
            } else {
                context.locals.user = null;
                context.locals.session = null;
            }
        } catch (error) {
            logger.error("Database connection error in middleware:", error);
            // Redirect to 503 page if database is down
            return context.redirect("/503");
        }
    } else {
        context.locals.user = null;
        context.locals.session = null;
    }

    if (context.url.pathname.startsWith("/dashboard")) {
        if (!context.locals.session) {
            const search = context.url.search;
            return context.redirect("/portal" + search);
        }
        
        // Block access to dashboard if email is not verified
        if (!context.locals.user?.emailVerified) {
            return context.redirect(`/portal?error=unverified&email=${encodeURIComponent(context.locals.user?.email || "")}`);
        }
    }

    if (context.request.method === "POST") {
        logger.log("Post Route Hit");
    }

    return next();
})