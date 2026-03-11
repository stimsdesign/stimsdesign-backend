/**
 * Users Module - Actions
 * Defines server-side logic for user-related form submissions and data mutations.
 * 
 * MODULAR ARCHITECTURE:
 * Logic is maintained here for modularity, but these actions are exported to 
 * 'src/actions.ts'. That central file acts as a mandatory 'Switchboard' for Astro 
 * to register these functions with its RPC system and generate type definitions.
 *
 * Related files:
 *   - src/actions.ts (The central registry)
 *   - src/modules/users/actions.ts (This file - The logic)
 *   - src/modules/users/add-new-user.astro
 * 
 * Zod:
 * Zod is a schema validation library used as a 'bouncer' for your data.
 * It ensures that data coming from the browser matches the expected shape and 
 * types before it touches the server or database.
 */

import { defineAction, ActionError } from "astro:actions";
import { z } from "zod";
import { db, clearCacheByPrefix } from "@stimsdesign/core/db";
import { Auth } from "../../utils/auth";
import { processImageFromBuffer } from "../../utils/images";
import { logger } from "@stimsdesign/core/logger";

// Redundant helper removed

const createSchema = z.object({
    name: z.string().min(2),
    email: z.string().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Invalid email"),
    password: z.string().regex(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/, {
        message: "Password must be at least 8 characters and include an uppercase, a number, and a special character."
    }),
    roles: z.array(z.string()).default([]),
    groups: z.array(z.string()).default([]),
    skipVerification: z.any().optional().transform(v => v === "true" || v === true),
});

const createGroupSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    minRoleWeight: z.coerce.number().int().default(9998),
});

const addUserToGroupSchema = z.object({
    userIds: z.array(z.string()),
    groupId: z.string(),
});

const addUsersByRoleSchema = z.object({
    roleIds: z.array(z.string()),
    groupId: z.string(),
});

const createRoleSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    weight: z.coerce.number().int().min(2), // 0 and 1 are reserved for superadmin/admin
    permissions: z.array(z.string()).default([]),
});

// Helper to adjust role weights to prevent collisions
const adjustRoleWeights = async (db: any, targetWeight: number, excludeRoleId?: string) => {
    // 1. Fetch all roles with weight >= targetWeight, ordered by weight ASC
    const { rows: roles } = await db.query('SELECT id, weight FROM "roles" WHERE weight >= $1 ORDER BY weight ASC', [targetWeight]);
    
    // 2. Filter out the role currently being updated (if any)
    const sortedRoles = excludeRoleId ? roles.filter((r: any) => r.id !== excludeRoleId) : roles;

    let collisionWeight = targetWeight;
    const updates = [];

    // 3. Iterate and find collisions
    for (const role of sortedRoles) {
        if (role.weight === collisionWeight) {
            // Collision found, this role needs to move
            updates.push({ id: role.id, weight: collisionWeight + 1 });
            collisionWeight++;
        } else if (role.weight > collisionWeight) {
            // Gap found, no more collisions possible in this chain
            break;
        }
    }

    // 4. Execute updates
    for (const update of updates) {
        await db.query('UPDATE "roles" SET weight = $1 WHERE id = $2', [update.weight, update.id]);
        logger.log(`[adjustRoleWeights] Shifted role ${update.id} to weight ${update.weight}`);
    }
};

export const usersActions = {
    /**
     * Manual User Creation
     * Creates a user in Better Auth and assigns initial roles/groups.
     */
    create: defineAction({
        accept: "form",
        input: createSchema,
        handler: async (input) => {
            const { name, email, password, roles: inputRoles, groups, skipVerification } = input;
            logger.log(`[createUser] Input: name=${name}, email=${email}, roles=${JSON.stringify(inputRoles)}, groups=${JSON.stringify(inputRoles)}, skip=${skipVerification}`);
            
            try {
                // 0. Build base roles
                const roles = [...new Set([...inputRoles, 'User'])]; // Always include User role

                // 1. Check if this is the first user
                const { rows: countRows } = await db.query('SELECT COUNT(*) as count FROM "user"');
                const isFirstUser = parseInt(countRows[0].count) === 0;

                if (isFirstUser) {
                    logger.log(`[createUser] First user detected. Assigning Superadmin role.`);
                    if (!roles.includes('Superadmin')) {
                        roles.push('Superadmin');
                    }
                }
                // 1. Create user via Better Auth API
                const user = await Auth.api.signUpEmail({
                    body: { name, email, password }
                });

                if (!user) throw new Error("Failed to create user account.");
                const userId = user.user.id;
                logger.log(`[createUser] Created User ID: ${userId}`);

                // 2. Skip Verification if requested
                if (skipVerification) {
                    await db.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [userId]);
                } else {
                    // Manually trigger verification since we disabled sendOnSignUp in auth.ts
                    await Auth.api.sendVerificationEmail({
                        body: {
                            email: email,
                            callbackURL: "/dashboard"
                        }
                    });
                }

                // 3. Assign Roles (Many-to-Many)
                if (roles.length > 0) {
                    for (const roleId of roles) {
                        await db.query('INSERT INTO "user_roles" ("userId", "roleId") VALUES ($1, $2)', [userId, roleId]);
                    }
                    
                    // Sync primary role to native Better Auth column based on MIN weight
                    const { rows: weightRows } = await db.query(`
                        SELECT "roleId" FROM "user_roles" ur 
                        JOIN "roles" r ON ur."roleId" = r.id 
                        WHERE ur."userId" = $1 
                        ORDER BY r.weight ASC LIMIT 1
                    `, [userId]);

                    if (weightRows.length > 0) {
                        const primaryRole = weightRows[0].roleId;
                        await db.query('UPDATE "user" SET "role" = $1 WHERE id = $2', [primaryRole, userId]);
                        logger.log(`[createUser] Synced primary role '${primaryRole}' to user table based on weight.`);
                    }
                }

                // 3. Assign Groups (Many-to-Many)
                if (groups.length > 0) {
                    for (const groupId of groups) {
                        await db.query('INSERT INTO "user_groups" ("userId", "groupId") VALUES ($1, $2)', [userId, groupId]);
                    }
                }
                
                return { 
                    success: true, 
                    userId, 
                    isVerified: !!skipVerification 
                };
            } catch (error: any) {
                logger.error("[createUser] Action Error:", error);
                return { success: false, error: error.message || "Failed to create user" };
            } finally {
                // Clear user-related caches
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Create New Group
     */
    createGroup: defineAction({
        accept: "form",
        input: createGroupSchema.extend({
            userIds: z.array(z.string()).optional(),
            initialRoleIds: z.array(z.string()).optional(),
        }),
        handler: async (input) => {
            try {
                // 1. Create Group
                const id = Math.random().toString(36).substring(2) + Date.now().toString(36);
                await db.query('INSERT INTO "groups" (id, name, description, "minRoleWeight") VALUES ($1, $2, $3, $4)', 
                    [id, input.name, input.description, input.minRoleWeight]);

                // 2. Add Initial Users (if provided)
                if (input.userIds && input.userIds.length > 0) {
                    for (const userId of input.userIds) {
                         const { rows: userRows } = await db.query(`
                            SELECT COALESCE(MIN(r.weight), 9999) as weight
                            FROM "user" u
                            LEFT JOIN "user_roles" ur ON u.id = ur."userId"
                            LEFT JOIN "roles" r ON ur."roleId" = r.id
                            WHERE u.id = $1
                            GROUP BY u.id
                        `, [userId]);
                        
                        if (userRows.length > 0) {
                            const userWeight = userRows[0].weight;
                            if (userWeight <= input.minRoleWeight) {
                                 await db.query('INSERT INTO "user_groups" ("userId", "groupId") VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, id]);
                            }
                        }
                    }
                }

                // 3. Add Initial Role Members (if provided)
                if (input.initialRoleIds && input.initialRoleIds.length > 0) {
                    for (const roleId of input.initialRoleIds) {
                         const { rows: roleRows } = await db.query('SELECT weight FROM "roles" WHERE id = $1', [roleId]);
                         if (roleRows.length > 0) {
                             const roleWeight = roleRows[0].weight;
                             
                             if (roleWeight <= input.minRoleWeight) {
                                  await db.query(`
                                     INSERT INTO "user_groups" ("userId", "groupId")
                                     SELECT "userId", $1 FROM "user_roles" WHERE "roleId" = $2
                                     ON CONFLICT DO NOTHING
                                  `, [id, roleId]);
                             }
                         }
                    }
                }
                
                return { success: true };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Quick Add User to Group
     */
    addUserToGroup: defineAction({
        accept: "form",
        input: addUserToGroupSchema,
        handler: async (input) => {
            try {
                // 1. Get Group Min Weight
                const { rows: groupRows } = await db.query('SELECT "minRoleWeight" FROM "groups" WHERE id = $1', [input.groupId]);
                if (groupRows.length === 0) throw new Error("Group not found");
                const minWeight = groupRows[0].minRoleWeight;

                let successCount = 0;
                const errors: string[] = [];

                for (const userId of input.userIds) {
                    try {
                        // 2. Get User's Best Role Weight
                        const { rows: userRows } = await db.query(`
                            SELECT COALESCE(MIN(r.weight), 9999) as weight
                            FROM "user" u
                            LEFT JOIN "user_roles" ur ON u.id = ur."userId"
                            LEFT JOIN "roles" r ON ur."roleId" = r.id
                            WHERE u.id = $1
                            GROUP BY u.id
                        `, [userId]);
                        
                        if (userRows.length === 0) {
                            errors.push(`User ${userId} not found`);
                            continue;
                        }
                        const userWeight = userRows[0].weight;

                        // 3. User weight must be <= Group Min Weight (Lower is better/more authority)
                        if (userWeight > minWeight) {
                             errors.push(`User ${userId} does not meet criteria`);
                             continue;
                        }

                        await db.query('INSERT INTO "user_groups" ("userId", "groupId") VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, input.groupId]);
                        successCount++;
                    } catch (e: any) {
                        errors.push(e.message);
                    }
                }
                
                return { success: true, count: successCount, errors };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Remove User from Group
     */
    removeUserFromGroup: defineAction({
        // Keeping singular for removal for now as UI is row-based
        input: z.object({ userId: z.string(), groupId: z.string() }),
        handler: async (input) => {
            try {
                await db.query('DELETE FROM "user_groups" WHERE "userId" = $1 AND "groupId" = $2', [input.userId, input.groupId]);
                return { success: true };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Create Role with associated Permissions
     */
    createRole: defineAction({
        accept: "form",
        input: createRoleSchema,
        handler: async (input) => {
            try {
                // 1. Shift roles DOWN to make room for the new weight using smart cascade
                // Logic: prevent collisions by shifting only colliding roles
                await adjustRoleWeights(db, input.weight);

                // 2. Create the new role
                const roleId = Math.random().toString(36).substring(2) + Date.now().toString(36);
                await db.query('INSERT INTO "roles" (id, name, description, weight) VALUES ($1, $2, $3, $4)', [roleId, input.name, input.description, input.weight]);
                
                if (input.permissions && input.permissions.length > 0) {
                    for (const permId of input.permissions) {
                        await db.query('INSERT INTO "role_permissions" ("roleId", "permissionId") VALUES ($1, $2)', [roleId, permId]);
                    }
                }
                return { success: true };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Update User Details
     */
    updateUser: defineAction({
        accept: "form",
        input: z.object({
            id: z.string(),
            name: z.string().min(2),
            email: z.string().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Invalid email"),
            roles: z.array(z.string()).default([]),
            groups: z.array(z.string()).default([]),
            avatarFile: z.any().optional(), 
            removeAvatar: z.enum(['true', 'false']).optional(),
            avatar_bg: z.string().optional(),
            avatar_fg: z.string().optional(),
        }),
        handler: async (input, context) => {
            const { id, name, email, roles: inputRoles, groups, avatarFile, removeAvatar, avatar_bg, avatar_fg } = input;

            try {
                // 0. Security Check & Session Info
                const session = await Auth.api.getSession({ headers: context.request.headers });
                const currentUserRole = session?.user?.role?.toLowerCase();
                const isCurrentUserSuperadmin = currentUserRole === 'superadmin';

                // 1. Check if target user is a Superadmin (either by name or by existing roles)
                const { rows: targetRoles } = await db.query(`
                    SELECT r.name FROM "roles" r
                    JOIN "user_roles" ur ON r.id = ur."roleId"
                    WHERE ur."userId" = $1
                `, [id]);
                
                const isTargetSuperadmin = targetRoles.some((r: any) => r.name === 'Superadmin');

                // If target is Superadmin, only another Superadmin can edit
                if (isTargetSuperadmin && !isCurrentUserSuperadmin) {
                     throw new ActionError({ 
                         code: "FORBIDDEN", 
                         message: "Only Superadmins can edit other Superadmin accounts." 
                     });
                }

                // 2. Ensure "User" role is always preserved
                const roles = [...new Set([...inputRoles, 'User'])];
                // Determine image string to update if provided
                let imageUpdateStr = null;
                let shouldUpdateImage = false;

                if (removeAvatar === 'true') {
                     shouldUpdateImage = true;
                     imageUpdateStr = null;
                } else if (avatarFile instanceof File && avatarFile.size > 0 && avatarFile.name) {
                    
                    // Input Validation
                    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
                    if (!validTypes.includes(avatarFile.type)) {
                         throw new ActionError({ code: "BAD_REQUEST", message: "Only JPG and PNG images are allowed." });
                    }
                    if (avatarFile.size > 5 * 1024 * 1024) { // 5MB limit
                         throw new ActionError({ code: "BAD_REQUEST", message: "Avatar image must be smaller than 5MB." });
                    }

                    const arrayBuffer = await avatarFile.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    
                    // Process the image using central utility
                    imageUpdateStr = await processImageFromBuffer(buffer);
                    shouldUpdateImage = true;
                }

                // 1. Update User Basic Info + Avatar Settings
                if (shouldUpdateImage && imageUpdateStr === null) {
                     // Removing avatar: clear both custom_image AND native image column
                     await db.query('UPDATE "user" SET name = $1, email = $2, avatar_bg = $3, avatar_fg = $4, custom_image = NULL, image = NULL WHERE id = $5', 
                        [name, email, avatar_bg || null, avatar_fg || null, id]);
                } else if (shouldUpdateImage) {
                     await db.query('UPDATE "user" SET name = $1, email = $2, avatar_bg = $3, avatar_fg = $4, custom_image = $5 WHERE id = $6', [name, email, avatar_bg || null, avatar_fg || null, imageUpdateStr, id]);
                } else {
                     await db.query('UPDATE "user" SET name = $1, email = $2, avatar_bg = $3, avatar_fg = $4 WHERE id = $5', [name, email, avatar_bg || null, avatar_fg || null, id]);
                }

                // 2. Update Roles (Replace all)
                // Security Check: Prevent removing Superadmin role
                const { rows: currentRoles } = await db.query(`
                    SELECT r.id, r.name FROM "roles" r
                    JOIN "user_roles" ur ON r.id = ur."userId"
                    WHERE ur."userId" = $1
                `, [id]);

                const superadminRole = currentRoles.find((r: any) => r.name === 'Superadmin');
                if (superadminRole) {
                    if (!roles.includes(superadminRole.id)) {
                         throw new ActionError({ 
                             code: "FORBIDDEN", 
                             message: "Cannot remove Superadmin role. This role is protected." 
                         });
                    }
                }

                // First delete existing mappings
                await db.query('DELETE FROM "user_roles" WHERE "userId" = $1', [id]);
                
                // Insert new mappings
                if (roles.length > 0) {
                    for (const roleId of roles) {
                        await db.query('INSERT INTO "user_roles" ("userId", "roleId") VALUES ($1, $2)', [id, roleId]);
                    }
                    
                    // Sync primary role to native Better Auth column based on MIN weight
                    const { rows: weightRows } = await db.query(`
                        SELECT "roleId" FROM "user_roles" ur 
                        JOIN "roles" r ON ur."roleId" = r.id 
                        WHERE ur."userId" = $1 
                        ORDER BY r.weight ASC LIMIT 1
                    `, [id]);

                    if (weightRows.length > 0) {
                        const primaryRole = weightRows[0].roleId;
                        await db.query('UPDATE "user" SET "role" = $1 WHERE id = $2', [primaryRole, id]);
                    }
                } else {
                    // If no roles, clear the primary role column
                    await db.query('UPDATE "user" SET "role" = NULL WHERE id = $1', [id]);
                }

                // 3. Update Groups (Replace all)
                await db.query('DELETE FROM "user_groups" WHERE "userId" = $1', [id]);
                
                if (groups.length > 0) {
                    for (const groupId of groups) {
                        await db.query('INSERT INTO "user_groups" ("userId", "groupId") VALUES ($1, $2)', [id, groupId]);
                    }
                }

                return { success: true, name };
            } catch (error: any) {
                return { success: false, error: error.message };
            } finally {
                // Clear all relevant caches
                clearCacheByPrefix('users:');
            }
        }
    }),

    deleteUser: defineAction({
        accept: "json",
        input: z.object({ id: z.string() }),
        handler: async ({ id }) => {
            try {
                await db.query('DELETE FROM "user" WHERE id = $1', [id]);
                return { success: true };
            } catch (error: any) {
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    deleteGroup: defineAction({
        accept: "json",
        input: z.object({ id: z.string() }),
        handler: async ({ id }) => {
            try {
                await db.query('DELETE FROM "groups" WHERE id = $1', [id]);
                return { success: true };
            } catch (error: any) {
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    deleteRole: defineAction({
        accept: "json",
        input: z.object({ id: z.string() }),
        handler: async ({ id }) => {
            try {
                // Check if protected
                const { rows } = await db.query('SELECT name FROM "roles" WHERE id = $1', [id]);
                if (rows.length === 0) return { success: false, error: "Role not found" };
                
                const name = rows[0].name.toLowerCase();
                if (['superadmin', 'admin', 'user'].includes(name)) {
                     throw new ActionError({ code: "FORBIDDEN", message: `Cannot delete protected role '${rows[0].name}'` });
                }

                await db.query('DELETE FROM "roles" WHERE id = $1', [id]);
                return { success: true };
            } catch (error: any) {
                if (error.code === '23503') { 
                     return { success: false, error: "Cannot delete role because it is assigned to users." };
                }
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Update Role Details
     */
    updateRole: defineAction({
        accept: "form",
        input: z.object({
            id: z.string(),
            name: z.string().min(1),
            description: z.string().optional(),
            weight: z.coerce.number().int().min(0), // Allow 0 and 1 here, validate logic in handler
            permissions: z.array(z.string()).default([]),
        }),
        handler: async (input, context) => {
            const { id, name, description, weight, permissions } = input;
            try {
                // 0. Get Current User Session for Permission Checks
                const session = await Auth.api.getSession({ headers: context.request.headers });
                const currentUserRole = session?.user?.role?.toLowerCase();

                // 1. Check for protected roles (Superadmin/Admin weight cannot change)
                const { rows: currentRole } = await db.query('SELECT name, weight FROM "roles" WHERE id = $1', [id]);
                
                if (currentRole.length > 0) {
                    const currentName = currentRole[0].name.toLowerCase();

                    // PROTECTED ROLE LOGIC
                    if (['superadmin', 'admin'].includes(currentName)) {
                         
                        // Superadmin Role: NO ONE can edit, not even another superadmin (permissions might be synced via code/db-sync)
                        // User request: "Superadmin should be able to edit individual permissions [of Admin]... no one can edit 'Superadmin'."
                        if (currentName === 'superadmin') {
                            throw new ActionError({ code: "FORBIDDEN", message: " The 'Superadmin' role is system-managed and cannot be edited." });
                        }

                        // Admin Role: Only Superadmin can edit
                        if (currentName === 'admin') {
                            if (currentUserRole !== 'superadmin') {
                                throw new ActionError({ code: "FORBIDDEN", message: "Only Superadmins can edit the 'Admin' role." });
                            }
                        }

                         // Enforce Fixed Weight for Protected Roles
                         if (currentRole[0].weight !== weight) {
                             throw new ActionError({ code: "FORBIDDEN", message: `Cannot change the weight of protected role '${currentRole[0].name}'.` });
                         }
                         
                         // Enforce Fixed Name for Protected Roles
                         if (currentRole[0].name !== name) {
                             throw new ActionError({ code: "FORBIDDEN", message: `Cannot rename protected role '${currentRole[0].name}'.` });
                         }
                    }
                }

                // 2. Adjust Weights (Cascade)
                // Only if weight changed
                if (currentRole.length === 0 || currentRole[0].weight !== weight) {
                     // Safety check: Prevent setting weight 0 or 1 for non-protected roles manually if we wanted to
                     // But schema allows it now. Let's assume user knows what they are doing if they have permission.
                     // Actually, we should probably reserve 0 and 1.
                     const isProtected = ['superadmin', 'admin'].includes(currentRole[0]?.name?.toLowerCase());
                     if (!isProtected && weight < 2) {
                        throw new ActionError({ code: "BAD_REQUEST", message: "Weights 0 and 1 are reserved for system roles." });
                     }

                     await adjustRoleWeights(db, weight, id);
                }

                // 3. Update basic info role update
                await db.query('UPDATE "roles" SET name = $1, description = $2, weight = $3 WHERE id = $4', [name, description, weight, id]);

                // 4. Update permissions (Replace all)
                await db.query('DELETE FROM "role_permissions" WHERE "roleId" = $1', [id]);
                
                if (permissions && permissions.length > 0) {
                    for (const permId of permissions) {
                        await db.query('INSERT INTO "role_permissions" ("roleId", "permissionId") VALUES ($1, $2)', [id, permId]);
                    }
                }
                return { success: true, name };
            } catch (error: any) {
                // ActionError passes through nicely
                if (error instanceof ActionError) throw error;
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Update Group Details
     */
    updateGroup: defineAction({
        accept: "form",
        input: z.object({
            id: z.string(),
            name: z.string().min(1),
            description: z.string().optional(),
            minRoleWeight: z.coerce.number().int().default(9998),
        }),
        handler: async (input) => {
            const { id, name, description, minRoleWeight } = input;
            try {
                await db.query('UPDATE "groups" SET name = $1, description = $2, "minRoleWeight" = $3 WHERE id = $4', 
                    [name, description, minRoleWeight, id]);
                return { success: true, name };
            } catch (error: any) {
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Bulk Add Users by Role
     */
    addUsersByRole: defineAction({
        accept: "form", // Or json if called via fetch/axios directly with JSON body
        input: addUsersByRoleSchema,
        handler: async ({ roleIds, groupId }) => {
            try {
                // 1. Get Group Min Weight
                const { rows: groupRows } = await db.query('SELECT "minRoleWeight" FROM "groups" WHERE id = $1', [groupId]);
                if (groupRows.length === 0) throw new Error("Group not found");
                const minWeight = groupRows[0].minRoleWeight;

                let totalAdded = 0;

                for (const roleId of roleIds) {
                    // 2. Get Role Weight
                    const { rows: roleRows } = await db.query('SELECT weight FROM "roles" WHERE id = $1', [roleId]);
                    if (roleRows.length === 0) continue;
                    const roleWeight = roleRows[0].weight;

                    // 3. Validate Criteria (Role weight must be <= Group min weight)
                    if (roleWeight > minWeight) {
                        continue;
                    }

                    // 4. Find eligible users
                    // Users who have this specific role.
                    const { rows: users } = await db.query(`
                        SELECT "userId" FROM "user_roles" WHERE "roleId" = $1
                    `, [roleId]);

                    if (users.length === 0) continue;

                    // 5. Insert users
                    for (const user of users) {
                        const res = await db.query(`
                            INSERT INTO "user_groups" ("userId", "groupId") 
                            VALUES ($1, $2) 
                            ON CONFLICT DO NOTHING
                        `, [user.userId, groupId]);
                        if ((res as any).rowCount > 0) {
                            totalAdded++;
                        }
                    }
                }

                return { success: true, count: totalAdded };

            } catch (error: any) {
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),



    /**
     * Create Permission
     */
    createPermission: defineAction({
        accept: "form",
        input: z.object({
            resource: z.string().min(1),
            action: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/).toLowerCase(),
            description: z.string().optional(),
        }),
        handler: async (input) => {
            const { resource, action, description } = input;
            const safeResource = resource.toLowerCase().replace(/ \u00bb /g, ':');
            const id = `${safeResource}:${action}`;
            try {
                await db.query('INSERT INTO "permissions" (id, resource, action, description) VALUES ($1, $2, $3, $4)', 
                    [id, resource, action, description]);
                return { success: true, permission: { id, resource, action } };
            } catch (error: any) {
                 if (error.code === '23505') {
                    return { success: false, error: "Permission already exists." };
                }
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Update Permission
     */
    updatePermission: defineAction({
        accept: "form",
        input: z.object({
            id: z.string(),
            description: z.string().optional(),
        }),
        handler: async ({ id, description }) => {
            try {
                // Check if default? Actually defaults CAN be updated (description), just not deleted.
                // Wait, user said "Default permissions ... should be disabled/blocked from removal."
                // "Create the detail view and edit page ...".
                // So updating description is fine.
                await db.query('UPDATE "permissions" SET description = $1 WHERE id = $2', [description, id]);
                return { success: true };
            } catch (error: any) {
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Delete Permission
     */
    deletePermission: defineAction({
        accept: "json",
        input: z.object({ id: z.string() }),
        handler: async ({ id }) => {
            try {
                // 2. Check if it's a default permission (read/write/delete)
                const { rows } = await db.query('SELECT * FROM "permissions" WHERE id = $1', [id]);
            
                if (rows.length === 0) {
                    throw new ActionError({ code: "NOT_FOUND", message: "Permission not found." });
                }

                const perm = rows[0];
                if (['read', 'write', 'delete'].includes(perm.action)) {
                    throw new ActionError({ code: "FORBIDDEN", message: "Cannot delete default system permissions." });
                }

                await db.query('DELETE FROM "permissions" WHERE id = $1', [id]);
                return { success: true };
            } catch (error: any) {
                // FK violation check
                 if (error.code === '23503') {
                     return { success: false, error: "Cannot delete permission because it is assigned to roles." };
                }
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),


    /**
     * Manually Verify User Email
     */
    manuallyVerifyUser: defineAction({
        accept: "json",
        input: z.object({ id: z.string() }),
        handler: async ({ id }) => {
            try {
                await db.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [id]);
                return { success: true };
            } catch (error: any) {
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Remove User from Role
     */
    removeUserFromRole: defineAction({
        accept: "json",
        input: z.object({
            userId: z.string(),
            roleId: z.string(),
        }),
        handler: async ({ userId, roleId }) => {
            
            try {
                // Security Check: Prevent removing Superadmin role
                const { rows: roleCheck } = await db.query('SELECT name FROM "roles" WHERE id = $1', [roleId]);
                if (roleCheck.length > 0) {
                    if (roleCheck[0].name === 'Superadmin') {
                        throw new ActionError({ code: "FORBIDDEN", message: "Cannot remove user from Superadmin role." });
                    }
                }

                // 1. Remove the role mapping
                await db.query('DELETE FROM "user_roles" WHERE "userId" = $1 AND "roleId" = $2', [userId, roleId]);

                // 2. Recalculate Primary Role
                // Fetch remaining roles ordered by weight (ASC)
                const { rows: weightRows } = await db.query(`
                    SELECT "roleId" FROM "user_roles" ur 
                    JOIN "roles" r ON ur."roleId" = r.id 
                    WHERE ur."userId" = $1 
                    ORDER BY r.weight ASC LIMIT 1
                `, [userId]);

                if (weightRows.length > 0) {
                    const primaryRole = weightRows[0].roleId;
                    await db.query('UPDATE "user" SET "role" = $1 WHERE id = $2', [primaryRole, userId]);
                    console.log(`[removeUserFromRole] Recalculated primary role for user ${userId}: ${primaryRole}`);
                } else {
                    // No roles left, clear primary role
                    await db.query('UPDATE "user" SET "role" = NULL WHERE id = $1', [userId]);
                    console.log(`[removeUserFromRole] User ${userId} has no roles left. Cleared primary role.`);
                }

                return { success: true };

            } catch (error: any) {
                return { success: false, error: error.message };
            } finally {
                clearCacheByPrefix('users:');
            }
        }
    }),

    /**
     * Check if a user exists by email (for public forms like forgot password)
     */
    checkEmail: defineAction({
        accept: "json",
        input: z.object({ email: z.string().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Invalid email") }),
        handler: async ({ email }) => {
            const { rows } = await db.query('SELECT 1 FROM "user" WHERE email = $1', [email]);
            return { exists: rows.length > 0 };
        }
    })
};
