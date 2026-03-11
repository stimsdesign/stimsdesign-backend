/**
 * Declarative Database Schema for the Tickets Module
 * -----------------------------------------------
 * This file defines the tables, columns, and initial data (seeds) required by the Tickets module.
 * 
 * EXECUTION:
 * This schema is NOT applied at runtime by the application itself.
 * Instead, it is consumed by the local utility script `src/utils/db-sync.ts`.
 * 
 * TO APPLY CHANGES:
 * Run the following command in your terminal:
 * `npm run db:sync`
 * 
 * This script will:
 * 1. Read this schema definition.
 * 2. Compare it against the actual database (checking `information_schema`).
 * 3. Create missing tables, add missing columns, and remove orphaned columns (garbage collection).
 * 4. Run the `seeds` function to populate default data (e.g., default roles/permissions).
 */
export const moduleSchema = {
    tables: {
        tickets: {
            columns: {
                id: "TEXT PRIMARY KEY",
                title: "TEXT NOT NULL",
                description: "TEXT",
                status: "TEXT NOT NULL DEFAULT 'open'", // open, in-progress, closed
                priority: "TEXT NOT NULL DEFAULT 'medium'", // low, medium, high, urgent
                created_by: "TEXT NOT NULL REFERENCES \"user\"(id) ON DELETE CASCADE",
                assigned_to: "TEXT REFERENCES \"user\"(id) ON DELETE SET NULL",
                createdAt: "TIMESTAMP NOT NULL DEFAULT NOW()",
                updatedAt: "TIMESTAMP NOT NULL DEFAULT NOW()" 
            }
        },
        ticket_comments: {
            columns: {
                id: "TEXT PRIMARY KEY",
                ticket_id: "TEXT NOT NULL REFERENCES \"tickets\"(id) ON DELETE CASCADE",
                user_id: "TEXT NOT NULL REFERENCES \"user\"(id) ON DELETE CASCADE",
                content: "TEXT NOT NULL",
                createdAt: "TIMESTAMP NOT NULL DEFAULT NOW()"
            }
        }
    },
    seeds: async (db: any) => {
        // Default Permissions for Tickets
        const permissions = [
            { id: "tickets:read", resource: "TICKETS", action: "read", description: "User can read tickets" },
            { id: "tickets:write", resource: "TICKETS", action: "write", description: "User can create and edit tickets" },
            { id: "tickets:delete", resource: "TICKETS", action: "delete", description: "User can delete tickets" },
        ];

        for (const p of permissions) {
            await db.query(`
                INSERT INTO "permissions" (id, resource, action, description)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) DO NOTHING
            `, [p.id, p.resource, p.action, p.description]);
        }
        console.log("  🌱 Seeded default Tickets Permissions.");

        // Assign All Tickets Permissions to Superadmin and Admin
        const adminRoles = ['Superadmin', 'Admin']; // These roles are guaranteed to exist because 'users' module runs first
        for (const roleId of adminRoles) {
             for (const p of permissions) {
                await db.query(`
                    INSERT INTO "role_permissions" ("roleId", "permissionId")
                    VALUES ($1, $2)
                    ON CONFLICT DO NOTHING
                `, [roleId, p.id]);
             }
        }
        console.log("  🌱 Assigned 'tickets' permissions to Superadmin & Admin.");
    }
};