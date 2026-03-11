/**
 * Better-Auth Server Configuration
 * Defines authentication methods, database connection, and plugins.
 * https://www.better-auth.com/docs/installation#authentication-methods
 * 
 * Rebuild/Migrate command: npx @better-auth/cli@latest migrate
 *
 * Related files:
 *   - src/utils/auth.ts
 *   - src/utils/auth-client.ts
 *   - src/pages/api/auth/[...all].ts
 *   - src/middleware.ts
 *   - src/env.d.ts
 */

// connectionString: import.meta.env.DATABASE_URL
// baseURL: import.meta.env.BETTER_AUTH_URL,

import { betterAuth } from "better-auth";
import { admin, username } from "better-auth/plugins"
import { db } from "@stimsdesign/core/db";
import { processImageFromUrl } from "./images";
import { logger } from "@stimsdesign/core/logger";

/**
 * Helper to assign Superadmin role if it's the first user in the system.
 */
async function handleFirstUserPromotion() {
    try {
        // 1. Check if we only have exactly 1 user
        const { rows: users } = await db.query('SELECT id, email FROM "user" LIMIT 2');
        
        if (users.length === 1) {
            const user = users[0];
            
            // Assign Superadmin and User roles
            await db.query('INSERT INTO "user_roles" ("userId", "roleId") VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING', [user.id, 'Superadmin', 'User']);
            
            // Sync native role column
            await db.query('UPDATE "user" SET "role" = $1 WHERE id = $2 AND ("role" IS NULL OR "role" != $1)', ['Superadmin', user.id]);
        }
    } catch (err) {
        logger.error("Error in handleFirstUserPromotion:", err);
    }
}

/**
 * Better Auth Plugin to ensure the first registered user becomes Superadmin.
 */
const firstUserAdminPlugin = {
    id: "first-user-admin",
    hooks: {
        after: [
            {
                matcher: (ctx: any) => {
                    // Match any path that results in a successful session or user creation
                    return ctx.path.includes("/sign-up") || ctx.path.includes("/callback") || ctx.path.includes("/sign-in");
                },
                handler: async () => {
                    // We check the DB count on every auth event to ensure the first user is promoted.
                    // This is method-agnostic (Email, Social, etc.).
                    await handleFirstUserPromotion();
                    return {}; 
                }
            }
        ]
    }
};

export const Auth = betterAuth({
    baseURL: import.meta.env.BETTER_AUTH_URL,
    database: db,
    user: {
        additionalFields: {
            custom_image: {
                type: "string",
                required: false,
            },
            avatar_bg: {
                type: "string",
                required: false,
                defaultValue: "var(--color-background)"
            },
            avatar_fg: {
                type: "string",
                required: false,
                defaultValue: "var(--color-foreground)"
            }
        }
    },
    accountLinking: {
        enabled: true,
        updateUserInfoOnLink: true,
    },
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        async sendResetPassword(data: any, _request: any) {
            const { user, url } = data;
            const useEthereal = import.meta.env.USE_ETHEREAL === "TRUE";
            const { sendEmail } = await (useEthereal ? import("./dev/email-ethereal") : import("./email"));
            
            logger.log(`Sending password reset email to ${user.email} with url ${url}`);

            await sendEmail({
                to: user.email,
                subject: "Reset your password",
                template: {
                    name: "reset-password",
                    params: {
                        html: `<p>You requested a password reset. Please click the link below to set a new password:</p><p><a href="${url}">Reset Password</a></p><p>If you did not request this, please ignore this email.</p>`
                    }
                }
            });
        }
    },
    emailVerification: {
        autoSignInAfterVerification: true,
        sendOnSignUp: false,
        sendOnSignIn: true,
        //expiresIn: 86400,
        expiresIn: 160,
        async sendVerificationEmail(data, _request) {
            let { user, url } = data;
            
            // Override the default '/' callbackURL explicitly to '/dashboard'
            try {
                const parsedUrl = new URL(url);
                if (parsedUrl.searchParams.get("callbackURL") === "/" || !parsedUrl.searchParams.has("callbackURL")) {
                    parsedUrl.searchParams.set("callbackURL", "/dashboard");
                    url = parsedUrl.toString();
                }
            } catch (e) {
                logger.error("Failed to parse verification URL", e);
            }
            
            const cooldownKey = `verify-cooldown:${user.email}`;
            
            // Check for existing active cooldown
            const { rows: existing } = await db.query(
                "SELECT 1 FROM verification WHERE identifier = $1 AND \"expiresAt\" > NOW()",
                [cooldownKey]
            );

            if (existing.length > 0) {
                logger.log(`Verification resend throttled for ${user.email} (cooldown still active)`);
                return;
            }

            logger.log(`Sending verification email to ${user.email} with url ${url}`);
            const useEthereal = import.meta.env.USE_ETHEREAL === "TRUE";
            const { sendEmail } = await (useEthereal ? import("./dev/email-ethereal") : import("./email"));
            await sendEmail({
                to: user.email,
                subject: "Verify your email address",
                template: {
                    name: "verify-email",
                    params: {
                        html: `<p>Please verify your email by clicking the link below:</p><p><a href="${url}">Verify Email</a></p>`
                    }
                }
            });

            // Set cooldown for same duration as link expiry
            await db.query(
                "INSERT INTO verification (id, identifier, value, \"expiresAt\", \"createdAt\", \"updatedAt\") VALUES ($1, $2, $3, $4, NOW(), NOW())",
                [
                    Math.random().toString(36).substring(2) + Date.now().toString(36), // Random ID
                    cooldownKey,
                    "cooldown", // dummy value
                    new Date(Date.now() + 160 * 1000) // 160 second cooldown
                ]
            ).catch(err => logger.error("Failed to set cooldown:", err));
        },
    },
    socialProviders: {
        google: {
            clientId: import.meta.env.GOOGLE_CLIENT_ID as string,
            clientSecret: import.meta.env.GOOGLE_CLIENT_SECRET as string,
            mapProfileToUser: async (profile) => {
                let highResImage = profile.picture;
                if (highResImage && highResImage.includes('=')) {
                    // The user's specific instance gets a 429 error for any size parameter, even default (s96-c).
                    // We must completely strip the sizing parameters so it serves the max-resolution image natively without triggering the 429.
                    highResImage = highResImage.split('=')[0];
                }

                // Download and process the image locally to avoid provider dependency issues
                const processedImage = highResImage ? await processImageFromUrl(highResImage) : null;

                return {
                    image: processedImage || highResImage,
                };
            },
            overrideUserInfoOnSignIn: true,
        },
        twitter: {
            clientId: import.meta.env.TWITTER_CLIENT_ID as string,
            clientSecret: import.meta.env.TWITTER_CLIENT_SECRET as string,
            mapProfileToUser: async (profile: any) => {
                // Twitter returns a '..._normal.jpg' (usually 48x48).
                // We replace '_normal' with '_400x400' to get a higher quality 400x400 image.
                let highResImage = profile.data.profile_image_url;
                if (highResImage) {
                    highResImage = highResImage.replace('_normal', '_400x400');
                }

                // Download and process the image locally to avoid provider dependency issues
                const processedImage = highResImage ? await processImageFromUrl(highResImage) : null;

                return {
                    image: processedImage || highResImage,
                };
            },
            overrideUserInfoOnSignIn: true,
        }
    },
    plugins: [
        username(),
        admin(),
        firstUserAdminPlugin,
    ],
    hooks: {
        before: async (ctx: any) => {
            // Extra validation for sign-up
            if (ctx.path.endsWith("/sign-up/email")) {
                const password = ctx.body?.password;
                if (typeof password === "string") {
                    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
                    if (!passwordRegex.test(password)) {
                        throw new Error("Password must be at least 8 characters long and include at least one uppercase letter, one number, and one special character.");
                    }
                }
            }
        }
    }
})




