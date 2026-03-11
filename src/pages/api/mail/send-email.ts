/**
 * Send Email Action
 * Server-side route that processes form submissions to send a custom email.
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
import { sendEmail } from "../../../utils/email"

export const prerender = false;

export const POST: APIRoute = async ({ url, request, redirect }) => {
    const key = url.searchParams.get("key");
    const secret = process.env.STIMSDESIGN_SECRET_KEY;

    if (!secret || key !== secret) {
        return new Response(null, { status: 404 });
    }

    // Get the form data submitted by the user
    const formData = await request.formData();
    const to = formData.get("recipient") as string | null;
    const subject = formData.get("subject") as string | null;
    const message = formData.get("message") as string | null;

    // Throw an error if we're missing any of the needed fields.
    if (!to || !subject || !message) {
        throw new Error("Missing required fields");
    }

    // Try to send the email using a `sendEmail` function we'll create next. Throw
    // an error if it fails.
    try {
        const html = `<div>${message}</div>`;
        //await sendEmail({ to, subject, html });
        await sendEmail({ to, subject, template: { name: "custom", params: { html } } });
    } catch (error) {
        throw new Error("Failed to send email");
    }

    // Redirect the user to a success page after the email is sent.
    return redirect("/success.html");
};