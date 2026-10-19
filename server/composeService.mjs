// Low-friction compose flow for LOCKED, per-module templates.
//
// The idea: the end user clicks a mail icon on a record row. The system already
// knows all the structured data (booking no, shipper, POL, POD...). So it:
//   1. loads the module's LOCKED template (owned by the Super Admin)
//   2. loads the record and maps it to template placeholders
//   3. renders subject + body server-side and returns them READ-ONLY
//   4. prefills recipients; the user may only touch allow-listed fields
//
// On send, the server RE-RENDERS from the locked template and IGNORES any
// subject/body the client sends — so the content cannot be tampered with.

import { randomUUID } from 'node:crypto';
import { db } from './db.mjs';
import { render } from './templateEngine.mjs';
import { getMailer, DEFAULT_FROM } from './mailer.mjs';
import { TemplateNotFoundError } from './emailService.mjs';

export class RecordNotFoundError extends Error {
  constructor(key, id) {
    super(`No record found for module "${key}" with id "${id}"`);
    this.name = 'RecordNotFoundError';
  }
}

function loadTemplate(key) {
  return db.prepare('SELECT * FROM email_templates WHERE key = ? AND is_active = 1').get(key);
}

/**
 * Per-module record loaders. Each returns { data, defaults, attachments } where
 * `data` maps the record to the template's placeholders. Add a new entry here
 * to wire a new module into the low-friction flow — no template code needed.
 */
const MODULE_SOURCES = {
  booking_instruction(recordId) {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ? OR booking_no = ?').get(recordId, recordId);
    if (!b) return null;
    return {
      data: {
        bookingNo: b.booking_no,
        bookingDate: b.booking_date,
        shipper: b.shipper,
        consignee: b.consignee,
        carrier: b.carrier,
        pol: b.pol,
        pod: b.pod,
      },
      defaults: { to: b.contact_email || '' },
      // Auto-attachment the module would generate (simulated here).
      attachments: [{ name: `${b.booking_no.replace(/\//g, '_')}.pdf`, auto: true, size: '48 KB' }],
    };
  },
  // Other modules can be added the same way, e.g.:
  // purchase_order(recordId) { ... return { data, defaults, attachments } }
};

/**
 * Build the prefilled, locked compose payload for a record.
 * Returns everything the modal needs to render.
 */
export function compose(key, recordId) {
  const template = loadTemplate(key);
  if (!template) throw new TemplateNotFoundError(key);

  const source = MODULE_SOURCES[key];
  const loaded = source ? source(recordId) : null;
  if (source && !loaded) throw new RecordNotFoundError(key, recordId);

  const data = loaded?.data ?? {};
  // userNote is empty in the prefill (user may add it if allowed).
  const renderData = { ...data, userNote: '' };
  const { subject, html } = render(template.subject, template.body_html, renderData);

  const editableFields = JSON.parse(template.editable_fields || '[]');

  return {
    templateKey: template.key,
    templateName: template.name,
    isLocked: !!template.is_locked,
    editableFields,
    // prefilled recipients: record default first, then template default
    to: loaded?.defaults?.to || template.default_to || '',
    cc: template.default_cc || '',
    bcc: '',
    // LOCKED, read-only content (already rendered with record data)
    subject,
    bodyHtml: html,
    attachments: loaded?.attachments ?? [],
    recordData: data, // echoed back so send can re-render identically
  };
}

/**
 * Send an email for a record using a LOCKED template.
 * Security: the server re-renders subject/body from the template itself.
 * Any client-supplied subject/body is ignored. The user can only influence
 * allow-listed fields (to/cc/bcc and, if permitted, userNote/attachments).
 */
export async function sendFromRecord(key, recordId, userInput = {}) {
  const template = loadTemplate(key);
  if (!template) throw new TemplateNotFoundError(key);

  const editableFields = JSON.parse(template.editable_fields || '[]');
  const source = MODULE_SOURCES[key];
  const loaded = source ? source(recordId) : null;
  if (source && !loaded) throw new RecordNotFoundError(key, recordId);

  const recordData = loaded?.data ?? {};

  // Only accept userNote if the template explicitly allows it.
  const userNote = editableFields.includes('userNote') ? String(userInput.userNote ?? '') : '';

  // RE-RENDER from the locked template — ignore any client subject/body.
  const { subject, html } = render(template.subject, template.body_html, { ...recordData, userNote });

  // Recipients: use user-provided values only for allow-listed fields,
  // else fall back to the record/template defaults.
  const to = pick(editableFields, 'to', userInput.to, loaded?.defaults?.to || template.default_to);
  const cc = pick(editableFields, 'cc', userInput.cc, template.default_cc);
  const bcc = pick(editableFields, 'bcc', userInput.bcc, '');

  if (!to || !to.trim()) throw new Error('At least one recipient (To) is required');

  const mailer = getMailer();
  let status = 'sent';
  let error = null;
  try {
    await mailer.sendEmail({ from: opts_from(), to, cc, bcc, subject, html });
  } catch (e) {
    status = 'failed';
    error = e instanceof Error ? e.message : String(e);
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO sent_emails (id, template_key, to_address, cc_address, subject, body_html, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, key, to, cc, subject, html, status, error, new Date().toISOString());

  if (status === 'failed') throw new Error(error ?? 'Email send failed');
  return { id, subject, to, cc };
}

function pick(editableFields, field, userValue, fallback) {
  if (editableFields.includes(field) && userValue !== undefined && userValue !== null) {
    return String(userValue);
  }
  return fallback || '';
}

function opts_from() {
  return DEFAULT_FROM;
}

export function listBookings() {
  return db.prepare('SELECT * FROM bookings ORDER BY booking_date DESC').all();
}
