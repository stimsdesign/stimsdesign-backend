import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "@stimsdesign/core/logger";
import { db } from "@stimsdesign/core/db";

let initPromise: Promise<ModuleStatus[]> | null = null;

/**
 * Core Better Auth tables and their column definitions.
 * These will be created if they don't exist.
 */
const CORE_TABLES: Record<string, Record<string, string>> = {
    user: {
        id: "TEXT PRIMARY KEY",
        name: "TEXT NOT NULL",
        email: "TEXT NOT NULL UNIQUE",
        emailVerified: "BOOLEAN NOT NULL",
        image: "TEXT",
        createdAt: "TIMESTAMP NOT NULL",
        updatedAt: "TIMESTAMP NOT NULL",
        role: "TEXT",
        banned: "BOOLEAN",
        banReason: "TEXT",
        banExpires: "TIMESTAMP",
        username: "TEXT",
        displayUsername: "TEXT",
        custom_image: "TEXT",
        avatar_bg: "TEXT DEFAULT 'var(--color-background)'",
        avatar_fg: "TEXT DEFAULT 'var(--color-foreground)'"
    },
    session: {
        id: "TEXT PRIMARY KEY",
        expiresAt: "TIMESTAMP NOT NULL",
        token: "TEXT NOT NULL UNIQUE",
        createdAt: "TIMESTAMP NOT NULL",
        updatedAt: "TIMESTAMP NOT NULL",
        userId: "TEXT NOT NULL REFERENCES \"user\"(id) ON DELETE CASCADE",
        ipAddress: "TEXT",
        userAgent: "TEXT",
        impersonatedBy: "TEXT",
        activeOrganizationId: "TEXT"
    },
    account: {
        id: "TEXT PRIMARY KEY",
        accountId: "TEXT NOT NULL",
        providerId: "TEXT NOT NULL",
        userId: "TEXT NOT NULL REFERENCES \"user\"(id) ON DELETE CASCADE",
        accessToken: "TEXT",
        refreshToken: "TEXT",
        idToken: "TEXT",
        accessTokenExpiresAt: "TIMESTAMP",
        refreshTokenExpiresAt: "TIMESTAMP",
        scope: "TEXT",
        password: "TEXT",
        createdAt: "TIMESTAMP NOT NULL",
        updatedAt: "TIMESTAMP NOT NULL"
    },
    verification: {
        id: "TEXT PRIMARY KEY",
        identifier: "TEXT NOT NULL",
        value: "TEXT NOT NULL",
        expiresAt: "TIMESTAMP NOT NULL",
        createdAt: "TIMESTAMP",
        updatedAt: "TIMESTAMP"
    },
    _modules: {
        name: "TEXT PRIMARY KEY",
        status: "TEXT NOT NULL",
        updatedAt: "TIMESTAMP NOT NULL DEFAULT NOW()"
    }
};

/**
 * Core Better Auth columns that must NEVER be dropped by the sync script.
 */
const PROTECTED_COLUMNS: Record<string, string[]> = Object.fromEntries(
    Object.entries(CORE_TABLES).map(([table, cols]) => [table, Object.keys(cols)])
);

async function getTableColumns(pool: any, tableName: string): Promise<string[]> {
    try {
        const res = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
            [tableName]
        );
        return res.rows.map((r: any) => r.column_name);
    } catch (err) {
        return [];
    }
}

/**
 * Sync Result for a Module
 */
export interface ModuleStatus {
    module: string;
    status: "running" | "initializing" | "error";
    error?: string;
}

/**
 * Ensures the database is fully initialized.
 * This is now intended for EXPLICIT use by the /api/initialize endpoint.
 * It performs a fresh discovery and synchronization on every call.
 */
export async function ensureDbInitialized(): Promise<ModuleStatus[]> {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const results = await runSync(db, false); // Explicitly non-destructive
            return results;
        } catch (err) {
            logger.error(`❌ Failed to initialize database:`, err);
            throw err;
        } finally {
            // Reset promise to allow the next call to trigger a fresh sync
            initPromise = null;
        }
    })();

    return initPromise;
}

/**
 * Declartive Database Sync & Cleanup
 * @param pool - PG connection pool
 * @param destructive - If true, allow dropping orphaned columns and tables
 */
export async function runSync(pool: any, destructive: boolean = false): Promise<ModuleStatus[]> {
    logger.log(`🚀 Starting Declarative Database Sync & Cleanup (Runtime - Destructive: ${destructive})...`);
    
    const results: ModuleStatus[] = [];

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const modulesDir = path.resolve(__dirname, "../modules");
    
    if (!fs.existsSync(modulesDir)) {
        logger.error(`❌ Error: Modules directory not found at ${modulesDir}`);
        return [{ module: "system", status: "error", error: "Modules directory not found" }];
    }

    const aggregatedSchema = {
        tables: { ...CORE_TABLES } as Record<string, Record<string, string>>,
        extensions: {} as Record<string, Record<string, string>>,
        seeds: [] as ((pool: any) => Promise<void>)[],
    };

    // 1. Discover modules
    const modules = fs.readdirSync(modulesDir).filter(f => fs.statSync(path.join(modulesDir, f)).isDirectory());
    
    // Check if we can skip heavy sync
    try {
        const { rows: existingModules } = await pool.query('SELECT name FROM "_modules" WHERE status = \'running\'');
        const existingSet = new Set(existingModules.map((m: any) => m.name));
        const allMatch = modules.every(m => existingSet.has(m));
        
        if (allMatch && !destructive && modules.length > 0) {
            logger.log("  ✨ System is current. Skipping heavy schema sync.");
            return modules.map(m => ({ module: m, status: "running" }));
        }
    } catch (e) {
        // Table probably doesn't exist yet, proceed with full sync
    }
    
    // Sort to prioritize users module
    modules.sort((a, b) => {
        if (a === 'users') return -1;
        if (b === 'users') return 1;
        return a.localeCompare(b);
    });

    for (const moduleName of modules) {
        results.push({ module: moduleName, status: "initializing" });
        const schemaPath = path.join(modulesDir, moduleName, "schema.ts");
        
        if (fs.existsSync(schemaPath)) {
            try {
                const schemaUri = `file://${schemaPath.replace(/\\/g, "/")}`;
                const { moduleSchema } = await import(/* @vite-ignore */ `${schemaUri}?t=${Date.now()}`);
                
                if (moduleSchema) {
                    if (moduleSchema.tables) {
                        for (const [tableName, config] of Object.entries(moduleSchema.tables as any)) {
                            aggregatedSchema.tables[tableName] = { 
                                ...aggregatedSchema.tables[tableName], 
                                ...(config as any).columns 
                            };
                        }
                    }
                    if (moduleSchema.extensions) {
                        for (const [tableName, config] of Object.entries(moduleSchema.extensions as any)) {
                            const tableExtensions = (config as any).columns || {};
                            aggregatedSchema.extensions[tableName] = { 
                                ...aggregatedSchema.extensions[tableName], 
                                ...tableExtensions
                            };
                        }
                    }
                    if (moduleSchema.seeds && typeof moduleSchema.seeds === 'function') {
                        aggregatedSchema.seeds.push(moduleSchema.seeds);
                    }
                }
                const currentRes = results.find(r => r.module === moduleName);
                if (currentRes) currentRes.status = "running";
            } catch (err: any) {
                logger.error(`❌ Error importing schema from '${moduleName}':`, err);
                const currentRes = results.find(r => r.module === moduleName);
                if (currentRes) {
                    currentRes.status = "error";
                    currentRes.error = err.message;
                }
            }
        } else {
            const currentRes = results.find(r => r.module === moduleName);
            if (currentRes) currentRes.status = "running";
        }
    }

    // 2. Pre-merge extensions into tables for immediate creation
    for (const [tableName, extensionColumns] of Object.entries(aggregatedSchema.extensions)) {
        if (!aggregatedSchema.tables[tableName]) {
            aggregatedSchema.tables[tableName] = {};
        }
        Object.assign(aggregatedSchema.tables[tableName], extensionColumns);
    }

    // 3. Handle New/Custom Tables
    // Hardcoded priority for known dependencies. 
    // TODO: Implement a better DAG-based sorting if dependencies become more complex.
    const priority = [
        "user", 
        "groups", 
        "roles", 
        "permissions", 
        "verification", 
        "tickets", 
        "ticket_comments",
        "dashboard_widgets",
        "user_preferences"
    ];
    const tableNames = Object.keys(aggregatedSchema.tables).sort((a, b) => {
        const aIndex = priority.indexOf(a);
        const bIndex = priority.indexOf(b);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.localeCompare(b);
    });

    for (const tableName of tableNames) {
        const columns = aggregatedSchema.tables[tableName];
        const colDefs = Object.entries(columns).map(([name, def]) => {
            if (name === "PRIMARY KEY") return `PRIMARY KEY ${def}`;
            return `"${name}" ${def}`;
        }).join(", ");
        await pool.query(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`);
        
        const existingCols = await getTableColumns(pool, tableName);
        
        for (const [colName, colDef] of Object.entries(columns)) {
            if (colName === "PRIMARY KEY") continue;
            if (!existingCols.includes(colName)) {
                await pool.query(`ALTER TABLE "${tableName}" ADD COLUMN "${colName}" ${colDef}`);
            }
        }

        // Drop orphaned columns (Only if destructive)
        if (destructive) {
            for (const existingCol of existingCols) {
                if (!Object.keys(columns).includes(existingCol)) {
                    logger.log(`  🗑️ (Destructive) Dropping orphaned column: ${existingCol}`);
                    await pool.query(`ALTER TABLE "${tableName}" DROP COLUMN "${existingCol}"`).catch(() => {});
                }
            }
        }
    }

    // 4. Final Cleanup pass (orphaned columns from PROTECTED list)
    if (destructive) {
        const allTables = new Set([...Object.keys(aggregatedSchema.extensions), ...Object.keys(PROTECTED_COLUMNS)]);
        for (const tableName of allTables) {
            const existingCols = await getTableColumns(pool, tableName);
            if (existingCols.length === 0) continue;
            
            const definedCols = aggregatedSchema.extensions[tableName] || {};
            const protectedCols = PROTECTED_COLUMNS[tableName] || [];

            for (const existingCol of existingCols) {
                const isProtected = protectedCols.includes(existingCol);
                const isDefined = Object.keys(definedCols).includes(existingCol);
                if (!isProtected && !isDefined) {
                    logger.log(`  🗑️ (Destructive) Dropping orphaned column in ${tableName}: ${existingCol}`);
                    await pool.query(`ALTER TABLE "${tableName}" DROP COLUMN "${existingCol}"`).catch(() => {});
                }
            }
        }
    }

    // 5. Run Modular Seeds
    for (const seedFn of aggregatedSchema.seeds) {
        try {
            await seedFn(pool);
        } catch (err) {
            logger.error(`❌ Seeding failed:`, err);
        }
    }

    // 6. Auto-Seed Dynamic Permissions & Assign to Superadmin
    try {
        const dynamicResources = new Set<string>();
        
        function scanDirectory(dir: string, baseDir: string) {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    scanDirectory(fullPath, baseDir);
                } else if (file.endsWith('.astro') && !file.includes('[')) {
                    // Extract relative path to exactly match `import.meta.glob('/src/modules/**/*.astro')` structure
                    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
                    const parts = relPath.split('/');
                    if (parts.length === 2) {
                        const moduleName = parts[0].toUpperCase();
                        const fileName = parts[1].replace('.astro', '').toUpperCase();
                        if (fileName === 'INDEX') {
                            dynamicResources.add(moduleName);
                        } else {
                            dynamicResources.add(`${moduleName} » ${fileName}`);
                        }
                    }
                }
            }
        }
        
        scanDirectory(modulesDir, modulesDir);

        // Insert generic read/write/delete permissions for each discovered resource
        for (const resource of dynamicResources) {
            const defaultActions = ['read', 'write', 'delete'];
            for (const action of defaultActions) {
                // Ensure IDs are safe and database friendly
                const safeResource = resource.toLowerCase().replace(/ \u00bb /g, ':');
                const permId = `${safeResource}:${action}`;
                const description = `Default ${action} permission for ${resource}`;
                await pool.query(`
                    INSERT INTO "permissions" (id, resource, action, description)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (id) DO UPDATE SET resource = EXCLUDED.resource
                `, [permId, resource, action, description]);
            }
        }
        
        logger.log(`  🌱 Auto-seeded derived permissions from ${dynamicResources.size} module resources.`);

        // Assign all permissions to Superadmin
        const { rows: superadminRows } = await pool.query(`SELECT id FROM "roles" WHERE LOWER(name) = 'superadmin' LIMIT 1`);
        if (superadminRows.length > 0) {
            const superadminId = superadminRows[0].id;
            const { rows: allPerms } = await pool.query(`SELECT id FROM "permissions"`);
            for (const perm of allPerms) {
                await pool.query(`
                    INSERT INTO "role_permissions" ("roleId", "permissionId")
                    VALUES ($1, $2)
                    ON CONFLICT DO NOTHING
                `, [superadminId, perm.id]);
            }
            logger.log("  👑 Granted all permissions to Superadmin explicitly.");
        }

    } catch (err) {
        logger.error(`❌ Auto-seeding permissions failed:`, err);
    }

    // 7. Record initialization status
    for (const moduleName of modules) {
        await pool.query(`
            INSERT INTO "_modules" (name, status, "updatedAt") 
            VALUES ($1, 'running', NOW())
            ON CONFLICT (name) DO UPDATE SET status = 'running', "updatedAt" = NOW()
        `, [moduleName]);
    }

    logger.log(`\n✅ Declarative Sync complete (Runtime).`);
    return results;
}
