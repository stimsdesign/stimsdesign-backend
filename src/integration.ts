import type { AstroIntegration } from "astro";

export default function backendIntegration(): AstroIntegration {
    return {
        name: "@stims/backend",
        hooks: {
            "astro:config:setup": ({ injectRoute }) => {
                // UI Dashboard Routes
                injectRoute({
                    pattern: "/dashboard/[...path]",
                    entrypoint: "@stimsdesign/backend/pages/dashboard/[...path].astro",
                });

                // Authentication Endpoints
                injectRoute({
                    pattern: "/api/auth/[...all]",
                    entrypoint: "@stimsdesign/backend/pages/api/auth/[...all].ts",
                });
                
                // Mail Endpoints
                injectRoute({
                    pattern: "/api/mail/send-email",
                    entrypoint: "@stimsdesign/backend/pages/api/mail/send-email.ts",
                });
                injectRoute({
                    pattern: "/api/mail/send-welcome-email",
                    entrypoint: "@stimsdesign/backend/pages/api/mail/send-welcome-email.ts",
                });

                // Dev Endpoints
                injectRoute({
                    pattern: "/api/dev/clear-cache",
                    entrypoint: "@stimsdesign/backend/pages/api/dev/clear-cache.ts",
                });

                // Initialization Endpoints
                injectRoute({
                    pattern: "/api/initialize",
                    entrypoint: "@stimsdesign/backend/pages/api/initialize.ts",
                });
            },
        },
    };
}
