/**
 * Astro Environment Type Definitions
 * Defines global types for the project, including the Astro.Locals interface.
 * This is where you set the types for data passed from middleware to pages.
 * https://docs.astro.build/en/guides/middleware/#typescript
 *
 * Related files:
 *   - src/middleware.ts
 *   - src/utils/auth.ts
 *   - src/utils/auth-client.ts
 *   - src/pages/api/auth/[...all].ts
 */

declare namespace App {
    interface Locals {
        user: typeof import("./utils/auth").Auth.$Infer.Session.user | null;
        session: typeof import("./utils/auth").Auth.$Infer.Session.session | null;
    }

    interface ImportMetaEnv {
        readonly USE_ETHEREAL: string;
        readonly ENABLE_DEBUG_LOGGING: string;
        readonly ENABLE_MAINTENANCE_MODE: string;
    }
}