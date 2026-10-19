// Provider-agnostic mailer — same interface MakerKit exposes:
//   sendEmail({ from, to, subject, html })
// Ships a MOCK adapter so it runs with zero SMTP/API setup.

class MockMailer {
  async sendEmail({ from, to, cc, bcc, subject, html }) {
    console.log('\n──────── 📧 MOCK EMAIL SENT ────────');
    console.log('From   :', from);
    console.log('To     :', to);
    if (cc) console.log('CC     :', cc);
    if (bcc) console.log('BCC    :', bcc);
    console.log('Subject:', subject);
    console.log('HTML   :', String(html).slice(0, 160) + '…');
    console.log('────────────────────────────────────\n');
    return { id: `mock_${Date.now()}` };
  }
}

/*
 * Real provider example (Nodemailer) — enable when you have a registry/SMTP:
 *
 *   import nodemailer from 'nodemailer';
 *   class NodemailerMailer {
 *     transport = nodemailer.createTransport({ host, port, auth });
 *     async sendEmail(p) { const i = await this.transport.sendMail(p); return { id: i.messageId }; }
 *   }
 *
 * Then switch on process.env.MAILER_PROVIDER inside getMailer().
 */

let instance = null;
export function getMailer() {
  if (!instance) instance = new MockMailer();
  return instance;
}

export const DEFAULT_FROM = process.env.EMAIL_FROM ?? 'no-reply@example.com';
