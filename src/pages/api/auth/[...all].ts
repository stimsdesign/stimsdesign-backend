export const prerender = false;
/**
 * Better-Auth Catch-all Route Handler
 * Mounts the Better-Auth server-side handler to process all authentication-related requests.
 * https://www.better-auth.com/docs/installation#mount-handler
 *
 * Related files:
 *   - src/utils/auth.ts
 *   - src/utils/auth-client.ts
 *   - src/pages/api/auth/[...all].ts
 *   - src/middleware.ts
 *   - src/env.d.ts
 */

import { Auth } from "../../../utils/auth";
import type { APIRoute } from "astro";

export const ALL: APIRoute = ({ request }) => {
    return Auth.handler(request);
};
