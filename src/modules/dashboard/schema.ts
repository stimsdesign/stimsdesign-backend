/**
 * Declarative Database Schema for the Dashboard Module
 */
export const moduleSchema = {
    tables: {
        dashboard_widgets: {
            columns: {
                id: "TEXT PRIMARY KEY",
                userId: "TEXT NOT NULL REFERENCES \"user\"(id) ON DELETE CASCADE",
                type: "TEXT NOT NULL",
                config: "JSONB",
                position: "INTEGER NOT NULL DEFAULT 0",
                updatedAt: "TIMESTAMP NOT NULL DEFAULT NOW()"
            }
        }
    },
    seeds: async (_db: any) => {
        // Placeholder for dashboard specific seeds
        console.log("  🌱 Initialized Dashboard module.");
    }
};
