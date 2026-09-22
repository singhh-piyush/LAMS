// Email transport for LAMS.
//
// One sendMail() function, three possible transports chosen by MAIL_TRANSPORT
// in .env. Swapping provider is a config change, never a code change.
//
//   console  (default) - prints the message to the terminal. No account needed,
//                        so a fresh clone runs and the reset flow is testable
//                        on any machine with zero setup.
//   mailtrap           - posts to the Mailtrap sandbox API. Mail is captured in
//                        the Mailtrap web inbox and delivered to nobody, which
//                        is what we demo from.
//   smtp               - ordinary SMTP via nodemailer. Works with Mailtrap SMTP,
//                        Gmail with an App Password, or any other mail server.

const MODE = (process.env.MAIL_TRANSPORT || 'console').toLowerCase();
const FROM_EMAIL = process.env.MAIL_FROM || 'noreply@lams.local';
const FROM_NAME = process.env.MAIL_FROM_NAME || 'LAMS Lab System';

async function sendViaConsole({ to, subject, text }) {
    console.log('\n' + '='.repeat(64));
    console.log('EMAIL (console transport - not actually sent)');
    console.log('To:      ' + to);
    console.log('Subject: ' + subject);
    console.log('-'.repeat(64));
    console.log(text);
    console.log('='.repeat(64) + '\n');
    return { transport: 'console' };
}

async function sendViaMailtrap({ to, subject, text, html }) {
    const token = process.env.MAILTRAP_TOKEN;
    const inbox = process.env.MAILTRAP_INBOX_ID;
    if (!token || !inbox) {
        throw new Error('MAILTRAP_TOKEN and MAILTRAP_INBOX_ID must be set in .env');
    }

    const response = await fetch(`https://sandbox.api.mailtrap.io/api/send/${inbox}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Api-Token': token
        },
        body: JSON.stringify({
            from: { email: FROM_EMAIL, name: FROM_NAME },
            to: [{ email: to }],
            subject,
            text,
            html: html || undefined
        })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
        throw new Error('Mailtrap rejected the message: ' + JSON.stringify(body));
    }
    return { transport: 'mailtrap', ids: body.message_ids };
}

async function sendViaSmtp({ to, subject, text, html }) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '2525', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to, subject, text, html
    });
    return { transport: 'smtp' };
}

async function sendMail(message) {
    try {
        if (MODE === 'mailtrap') return await sendViaMailtrap(message);
        if (MODE === 'smtp') return await sendViaSmtp(message);
        return await sendViaConsole(message);
    } catch (error) {
        // A mail failure must never crash the request or reveal to the caller
        // whether an address exists. Log it and fall back to the console so the
        // reset link is still recoverable during a demo.
        console.error('Mail send failed (' + MODE + '):', error.message);
        await sendViaConsole(message);
        return { transport: 'console-fallback', error: error.message };
    }
}

module.exports = { sendMail, MODE };
