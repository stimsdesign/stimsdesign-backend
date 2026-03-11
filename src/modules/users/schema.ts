/**
 * Declarative Database Schema for the Users Module
 */
import { logger } from "@stimsdesign/core/logger";
export const moduleSchema = {
    tables: {
        groups: {
            columns: {
                id: "TEXT PRIMARY KEY",
                name: "TEXT NOT NULL UNIQUE",
                description: "TEXT",
                minRoleWeight: "INTEGER NOT NULL DEFAULT 9998",
                createdAt: "TIMESTAMP NOT NULL DEFAULT NOW()",
                updatedAt: "TIMESTAMP NOT NULL DEFAULT NOW()"
            }
        },
        roles: {
            columns: {
                id: "TEXT PRIMARY KEY",
                name: "TEXT NOT NULL UNIQUE",
                description: "TEXT",
                weight: "INTEGER NOT NULL DEFAULT 99",
                createdAt: "TIMESTAMP NOT NULL DEFAULT NOW()",
                updatedAt: "TIMESTAMP NOT NULL DEFAULT NOW()"
            }
        },
        permissions: {
            columns: {
                id: "TEXT PRIMARY KEY",
                resource: "TEXT NOT NULL",
                action: "TEXT NOT NULL",
                description: "TEXT"
            }
        },
        user_groups: {
            columns: {
                userId: "TEXT NOT NULL REFERENCES \"user\"(id) ON DELETE CASCADE",
                groupId: "TEXT NOT NULL REFERENCES \"groups\"(id) ON DELETE CASCADE",
                "PRIMARY KEY": "(\"userId\", \"groupId\")"
            }
        },
        user_roles: {
            columns: {
                userId: "TEXT NOT NULL REFERENCES \"user\"(id) ON DELETE CASCADE",
                roleId: "TEXT NOT NULL REFERENCES \"roles\"(id) ON DELETE CASCADE",
                "PRIMARY KEY": "(\"userId\", \"roleId\")"
            }
        },
        role_permissions: {
            columns: {
                roleId: "TEXT NOT NULL REFERENCES \"roles\"(id) ON DELETE CASCADE",
                permissionId: "TEXT NOT NULL REFERENCES \"permissions\"(id) ON DELETE CASCADE",
                "PRIMARY KEY": "(\"roleId\", \"permissionId\")"
            }
        }
    },
    seeds: async (db: any) => {
        // 1. Default Permissions
        const permissions = [
            { id: "users:read", resource: "USERS", action: "read", description: "User can read users" },
            { id: "users:write", resource: "USERS", action: "write", description: "User can create and edit users" },
            { id: "users:delete", resource: "USERS", action: "delete", description: "User can delete users" },
        ];

        for (const p of permissions) {
            await db.query(`
                INSERT INTO "permissions" (id, resource, action, description)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) DO NOTHING
            `, [p.id, p.resource, p.action, p.description]);
        }
        logger.log("  🌱 Seeded default Core Permissions.");

        // 2. Default Roles
        const roleDefinitions = [
            { name: "Superadmin", weight: 0 },
            { name: "Admin", weight: 1 },
            { name: "Manager", weight: 2 },
            { name: "Staff", weight: 3 },
            { name: "Subscriber", weight: 4 },
            { name: "Customer", weight: 5 },
            { name: "User", weight: 9999 },
        ];
        for (const role of roleDefinitions) {
            await db.query(`
                INSERT INTO "roles" (id, name, description, weight)
                VALUES ($1, $1, $2, $3)
                ON CONFLICT (id) DO NOTHING
            `, [role.name, `Default ${role.name} role`, role.weight]);
        }
        logger.log("  🌱 Seeded default Core Roles.");

        // 3. Default Groups
        const groups = [
            { name: "Administrators", minRoleWeight: 1 },
            { name: "Company", minRoleWeight: 2 },
            { name: "Team", minRoleWeight: 2 },
            { name: "Customers", minRoleWeight: 2 }
        ];
        for (const group of groups) {
            await db.query(`
                INSERT INTO "groups" (id, name, description, "minRoleWeight")
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) DO NOTHING
            `, [group.name, group.name, `Default ${group.name} group`, group.minRoleWeight]);
        }
        logger.log("  🌱 Seeded default Core Groups.");

        // 4. Assign All Users Permissions to Superadmin and Admin
        const adminRoles = ['Superadmin', 'Admin'];
        for (const roleId of adminRoles) {
            for (const p of permissions) {
                await db.query(`
                    INSERT INTO "role_permissions" ("roleId", "permissionId")
                    VALUES ($1, $2)
                    ON CONFLICT DO NOTHING
                `, [roleId, p.id]);
            }
        }
        logger.log("  🌱 Assigned 'users' permissions to Superadmin & Admin.");
    }
};
