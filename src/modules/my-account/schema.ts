/**
 * Declarative Database Schema for the My Account Module
 */
export const moduleSchema = {
    tables: {
        user_preferences: {
            columns: {
                userId: "TEXT PRIMARY KEY REFERENCES \"user\"(id) ON DELETE CASCADE",
                theme: "TEXT NOT NULL DEFAULT 'system'",
                notifications: "BOOLEAN NOT NULL DEFAULT true",
                updatedAt: "TIMESTAMP NOT NULL DEFAULT NOW()"
            }
        }
    },
    seeds: async (_db: any) => {
        // Placeholder for my-account specific seeds
        console.log("  🌱 Initialized My Account module.");
    }
};
