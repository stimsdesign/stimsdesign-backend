# 🟠 @stimsdesign/backend

The `@stimsdesign/backend` package is a monolithic, drop-in CRM and Dashboard environment for STIMS Design web projects. Built as an Astro Integration, it dynamically injects an authenticated portal, user management system, and secure API endpoints into any Astro host project with exactly 4 lines of code.

## 📦 Features
- **Astro Integration (`integration.ts`):** Programmatically injects UI files, Dashboard layouts, and API routes into the host without polluting the host's `src/pages/` directory.
- **Authentication:** Fully configured [Better Auth](https://www.better-auth.com/) instance with Postgres database adapters, Google/Twitter social providers, and Passkey support.
- **Role-Based Access Control (RBAC):** Custom, natively integrated weighted role matrices, permission hierarchies, and user grouping logic.
- **Email Delivery:** Ready-to-use EJS HTML email templates sent via Resend's secure SMTP transport.
- **Modular Dashboard:** A highly encapsulated directory structure in `src/modules/` where every feature (Users, Tickets, CRM) contains its own schemas, actions, and UI components.

## 🚀 Installation

This package relies on `@stimsdesign/core` for database connectivity. Ensure the core repository is checked out. When utilizing the STIMS Design Monorepo Architecture via Git Submodules, run:

```bash
# Add the core dependencies
git submodule add https://github.com/stimsdesign/stimsdesign-core.git packages/core

# Add the backend dashboard
git submodule add https://github.com/stimsdesign/stimsdesign-backend.git packages/backend
```

Run Node Package Manager at the project root to install all embedded workspace dependencies:
```bash
npm install
```

## 🔌 Integrating into an Astro Project

To connect the backend package into your frontend website, you must provide 4 pieces of "Glue Code":

**1. `astro.config.mjs`** (Inject the routes)
```javascript
import backendIntegration from '@stimsdesign/backend/integration';

export default defineConfig({
  integrations: [backendIntegration()]
});
```

**2. `src/middleware.ts`** (Secure the application)
```typescript
export { onRequest } from '@stimsdesign/backend/middleware';
```

**3. `src/env.d.ts`** (Inject Session Typings)
```typescript
/// <reference path="./backend/env.d.ts" />
```

**4. `src/actions/index.ts`** (Register RPC Mutations)
```typescript
import { server } from '@stimsdesign/backend/actions';

export const server = {
    ...backendServerActions
};
```

## 🔐 Environment Variables
The host project must supply the following environment variables.

```env
# URL Configuration
PUBLIC_APP_URL="http://localhost:4321"    # Used for local dev
BETTER_AUTH_URL="http://localhost:4321"

# BetterAuth Security Secrets
BETTER_AUTH_SECRET="rand_gen_complex_string"

# Authentication Providers
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
TWITTER_CLIENT_ID="..."
TWITTER_CLIENT_SECRET="..."

# Email Verification & Delivery
RESEND_API_KEY="..."
SEND_EMAIL_FROM="STIMS Design <no-reply@stimsdesign.com>"
```

## 🗄️ Database Initialization & First User Setup

### 1. Database Initialization
The database schema, required tables, and default RBAC roles (like `superadmin`, `admin`, `user`) are **automatically initialized** and synchronized during the Netlify build process via a custom Astro integration. 

You can also trigger a manual declarative sync at any time from your root directory:
```bash
npm run db:sync
```
*(Note: This sync is declarative and non-destructive. It will safely add new tables/columns or drop orphaned columns without deleting your existing row data).*

### 2. Setting Up the First "Superadmin"
For security reasons, there is no public route or secret URL to instantly become a Superadmin. The very first administrative user must be elevated manually.

1. Start your local development server (`npm run dev`).
2. Navigate to `<your-local-url>/portal` in your browser and create a new user account via the standard sign-up form.
3. Open your Neon Database Console (or your preferred Postgres client).
4. View the `users` table and locate your newly created user record.
5. Edit the `role` column for your user and change its value from `user` to `superadmin`.
6. Save the changes. Refresh your browser or log in again to access the full Dashboard and User Management interfaces!

## 🛠️ Modifying the UI 
The UI is strictly separated into Modules (e.g. `src/modules/users/`). 
1. Create a new folder for your module `src/modules/crm/`.
2. Define the schema in `schema.ts`.
3. Define the RPC Actions in `actions.ts`.
4. Create the UI page in `index.astro`.
5. Finally, export a `const sortOrder = 10;` from your page so the `DashboardNav.astro` component automatically lists it in the sidebar!
