/**
 * Email Utility - Development (Ethereal) & Production (Resend)
 * Uses Ethereal Email for local testing and Resend for production environments.
 * 
 * HOW TO USE FOR TESTING:
 * 1. Find where `sendEmail` is imported (e.g. src/utils/auth.ts)
 * 2. Temporarily change the import to use this file:
 *    FROM: const { sendEmail } = await import("./email");
 *    TO:   const { sendEmail } = await import("./dev/email-ethereal");
 * 3. Trigger the email action in your browser (e.g. requesting a password reset)
 * 4. Check your terminal running `npm run dev`
 * 5. Click the "Preview URL:" logged in the terminal to view the rendered template
 *
 * References:
 * https://resend.com/docs/send-with-astro
 * https://developers.netlify.com/guides/send-emails-with-astro-and-resend/#create-the-email-sending-utility
 *
 * Related files:
 *   - src/utils/email.ts
 *   - src/utils/dev/email-ethereal.ts
 *   - src/utils/templates/custom.ejs
 *   - src/utils/templates/welcome.ejs
 *   - src/pages/actions/send-email.ts
 *   - src/pages/actions/send-welcome-email.ts
 *   - src/pages/sendmail.astro
 *   - src/pages/success.astro
 */
import ejs from "ejs";
import fs from "fs";
import { logger } from "@stimsdesign/core/logger";
// Resend Email
//import { createTransport, type Transporter } from "nodemailer";
// Ethereal Email
import { createTestAccount, createTransport, getTestMessageUrl } from "nodemailer";
import type { Transporter } from "nodemailer";

type WelcomeEmailParams = {
    name: "welcome";
    params: {
        name: string;
    };
};

type CustomEmailParams = {
    name: "custom";
    params: {
        html: string;
    };
};

type VerifyEmailParams = {
    name: "verify-email";
    params: {
        html: string;
    };
};

type ResetPasswordParams = {
    name: "reset-password";
    params: {
        html: string;
    };
};

type TemplateParams = WelcomeEmailParams | CustomEmailParams | VerifyEmailParams | ResetPasswordParams;

type SendEmailOptions = {
    /** Email address of the recipient */
    to: string;
    /** Subject line of the email */
    subject: string;
    /** Message used for the body of the email */
    //html: string;
    template: TemplateParams;
};

export async function sendEmail(options: SendEmailOptions): Promise<Transporter> {
    const transporter = await getEmailTransporter();
    return new Promise(async (resolve, reject) => {
        // Build the email message
        //const { to, subject, html } = options;
        const { to, subject, template } = options;
        // Parse Email Template
        const html = await parseEmailTemplate(template.name, template.params);
        const from = process.env.SEND_EMAIL_FROM as string;
        const message = { to, subject, html, from };
        // Send the email
        transporter.sendMail(message, (err, info) => {
            // Log the error if one occurred
            if (err) {
                logger.error(err);
                reject(err);
            }
            // Log the message ID and preview URL if available.
            logger.log("Message sent:", info.messageId);
            const testUrl = getTestMessageUrl(info);
            if (testUrl) logger.log("Preview URL:", testUrl);
            resolve(info);
        });
    });
}

// Resend Email
// async function getEmailTransporter(): Promise<Transporter> {
//     return new Promise((resolve, reject) => {
//         if (!import.meta.env.RESEND_API_KEY) {
//             throw new Error("Missing Resend configuration");
//         }
//         const transporter = createTransport({
//             host: "smtp.resend.com",
//             secure: true,
//             port: 465,
//             auth: { user: "resend", pass: import.meta.env.RESEND_API_KEY },
//         });
//         resolve(transporter);
//     });
// }

// Ethereal Email
async function getEmailTransporter(): Promise<Transporter> {
    return new Promise((resolve, _reject) => {
        // Use Resend in production
        if (import.meta.env.PROD) {
            if (!process.env.RESEND_API_KEY) {
                throw new Error("Missing Resend configuration");
            }
            const transporter = createTransport({
                host: "smtp.resend.com",
                secure: true,
                port: 465,
                auth: { user: "resend", pass: process.env.RESEND_API_KEY as string },
            });
            resolve(transporter);
        }

        // Create a test email account using ethereal.email when in development
        createTestAccount((_err, account) => {
            const { user, pass, smtp } = account;
            const { host, port, secure } = smtp;
            const transporter = createTransport({ host, port, secure, auth: { user, pass } });
            resolve(transporter);
        });
    });
}


async function parseEmailTemplate(name: TemplateParams['name'], params: TemplateParams['params']): Promise<string> {
    // Read the raw template files
    const rawTemplate = fs.readFileSync(`./src/backend/utils/templates/${name}.ejs`, "utf8");
    // Run the template through EJS to replace variables with parameter values
    return ejs.render(rawTemplate, params);
}
