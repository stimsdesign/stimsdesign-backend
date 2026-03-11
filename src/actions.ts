/**
 * Backend Actions Registry
 * 
 * This file centralizes all server actions specifically for the dashboard/backend system.
 * It is then exported and merged into the root `src/actions/index.ts` file so Astro
 * can compile the RPC endpoints while maintaining type safety.
 * 
 * When creating new backend modules with actions (like 'tickets'), import and register them here.
 */
import { usersActions } from "./modules/users/actions";

export const backendActions = {
    users: usersActions
};
