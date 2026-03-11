/**
 * Send Welcome Email Action
 * Server-side route that processes form submissions to send a welcome email template.
 * References:
 * https://resend.com/docs/send-with-astro
 * https://developers.netlify.com/guides/send-emails-with-astro-and-resend/#create-the-email-sending-utility
 *
 * Related files:
 *   - src/utils/email.ts
 *   - src/utils/email-ethereal.ts
 *   - src/utils/templates/custom.ejs
 *   - src/utils/templates/welcome.ejs
 *   - src/pages/actions/send-email.ts
 *   - src/pages/actions/send-welcome-email.ts
 *   - src/pages/sendmail.astro
 *   - src/pages/success.astro
 */
import type { APIRoute } from "astro";
import { sendEmail } from "../../../utils/email";
import { logger } from "@stimsdesign/core/logger";

export const prerender = false;

export const POST: APIRoute = async ({ url, request, redirect }) => {
    const key = url.searchParams.get("key");
    const secret = import.meta.env.STIMSDESIGN_SECRET_KEY;

    if (!secret || key !== secret) {
        return new Response(null, { status: 404 });
    }

    // Get the form data submitted by the user
    const formData = await request.formData();
    const to = formData.get("recipient") as string | null;
    const subject = "Welcome to MyApp!";
    const name = formData.get("name") as string | null;

    if (!to || !name) {
        throw new Error("Missing required fields");
    }

    try {
        await sendEmail({ to, subject, template: { name: "welcome", params: { name } } });
    } catch (error) {
        logger.error(error);
        throw new Error("Failed to send email");
    }

    return redirect("/success/");
};