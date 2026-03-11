/**
 * Better-Auth Client Instance
 * Configures the client-side authentication library with necessary plugins.
 * https://www.better-auth.com/docs/installation#create-client-instance
 *
 * Related files:
 *   - src/utils/auth.ts
 *   - src/utils/auth-client.ts
 *   - src/pages/api/auth/[...all].ts
 *   - src/middleware.ts
 *   - src/env.d.ts
 */

// baseURL: import.meta.env.BETTER_AUTH_URL,

import { createAuthClient } from "better-auth/client"
import { usernameClient } from "better-auth/client/plugins"
export const authClient = createAuthClient({
    plugins: [
        usernameClient()
    ]
})

// const signIn = async () => {
//     const data = await authClient.signIn.social({
//         provider: "google",
//         provider: "twitter"
//     })
// }

// socialProviders: {
//     google: {
//         prompt: "select_account", 
//         clientId: process.env.GOOGLE_CLIENT_ID as string,
//         clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
//     },
// }

// const data = await authClient.signIn.social({
//     provider: "facebook",
//     idToken: {  
//         ...(platform === 'ios' ?
//             { token: idToken }  
//             : { token: accessToken, accessToken: accessToken }), 
//     },
// })