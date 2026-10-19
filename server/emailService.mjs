// THE developer-facing API. A developer's entire job is to call
// sendTemplatedEmail(key, to, data) when a business event happens.
// They never write, read, or edit HTML.

import { randomUUID } from 'node:crypto';
import { db } from './db.mjs';
import { render } from './templateEngine.mjs';
import { getMailer, DEFAULT_FROM } from './mailer.mjs';

export class TemplateNotFoundError extends Error {
  constructor(key) {
    super(`No active email template found for key "${key}"`);
    this.name = 'TemplateNotFoundError';
  }
}

function loadTemplateByKey(key) {
  return db.prepare('SELECT * FROM email_templates WHERE key = ? AND is_active = 1').get(key);
}

export async function sendTemplatedEmail(key, to, data = {}, opts = {}) {
  const template = loadTemplateByKey(key);
  if (!template) throw new TemplateNotFoundError(key);

  const { subject, html } = render(template.subject, template.body_html, data);

  const mailer = getMailer();
  let status = 'sent';
  let error = null;
  try {
    await mailer.sendEmail({ from: opts.from ?? DEFAULT_FROM, to, subject, html });
  } catch (e) {
    status = 'failed';
    error = e instanceof Error ? e.message : String(e);
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO sent_emails (id, template_key, to_address, subject, body_html, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, key, to, subject, html, status, error, new Date().toISOString());

  if (status === 'failed') throw new Error(error ?? 'Email send failed');
  return { id, subject };
}

export function listSentEmails(limit = 50) {
  return db.prepare('SELECT * FROM sent_emails ORDER BY created_at DESC LIMIT ?').all(limit);
}
