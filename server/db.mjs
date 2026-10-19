// Zero-dependency SQLite layer using Node's built-in node:sqlite (Node 22+).
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'data.sqlite');

export const db = new DatabaseSync(DB_PATH);

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id              TEXT PRIMARY KEY,
      key             TEXT UNIQUE NOT NULL,
      name            TEXT NOT NULL,
      category        TEXT NOT NULL DEFAULT 'general',
      subject         TEXT NOT NULL,
      body_html       TEXT NOT NULL,
      placeholders    TEXT NOT NULL DEFAULT '[]',
      is_active       INTEGER NOT NULL DEFAULT 1,
      -- Locked templates: subject/body are owned by the Super Admin and CANNOT
      -- be altered by the end user. The server re-renders them on send.
      is_locked       INTEGER NOT NULL DEFAULT 0,
      -- Which fields the END USER may edit in the compose modal (JSON array).
      -- e.g. ["to","cc","bcc","userNote","attachments"]
      editable_fields TEXT NOT NULL DEFAULT '["to","cc","bcc"]',
      -- Default recipients prefilled in the modal (comma-separated strings).
      default_to      TEXT NOT NULL DEFAULT '',
      default_cc      TEXT NOT NULL DEFAULT '',
      created_by      TEXT NOT NULL DEFAULT 'system',
      updated_by      TEXT NOT NULL DEFAULT 'system',
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_template_versions (
      id          TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      version_no  INTEGER NOT NULL,
      subject     TEXT NOT NULL,
      body_html   TEXT NOT NULL,
      edited_by   TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sent_emails (
      id           TEXT PRIMARY KEY,
      template_key TEXT NOT NULL,
      to_address   TEXT NOT NULL,
      cc_address   TEXT,
      subject      TEXT NOT NULL,
      body_html    TEXT NOT NULL,
      status       TEXT NOT NULL,
      error        TEXT,
      created_at   TEXT NOT NULL
    );

    -- Demo business data: a module's records (Booking Instructions).
    -- In a real app this is your existing domain table; the email flow just
    -- reads from it. The user never re-types any of these values.
    CREATE TABLE IF NOT EXISTS bookings (
      id             TEXT PRIMARY KEY,
      booking_no     TEXT NOT NULL,
      booking_date   TEXT NOT NULL,
      shipper        TEXT NOT NULL,
      consignee      TEXT,
      carrier        TEXT,
      pol            TEXT,
      pod            TEXT,
      planning_type  TEXT,
      -- default recipient derived from the carrier/shipper for this record
      contact_email  TEXT
    );
  `);
  migrate();
  seed();
  seedBookings();
}

/**
 * Lightweight, idempotent column migration for DBs created by an older version
 * of this schema (before is_locked / editable_fields / etc. existed). Adds any
 * missing columns so an existing data.sqlite keeps working without deletion.
 */
function migrate() {
  const ensureColumn = (table, column, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      console.log(`[db] migrated: added ${table}.${column}`);
    }
  };
  ensureColumn('email_templates', 'is_locked', 'is_locked INTEGER NOT NULL DEFAULT 0');
  ensureColumn('email_templates', 'editable_fields', `editable_fields TEXT NOT NULL DEFAULT '["to","cc","bcc"]'`);
  ensureColumn('email_templates', 'default_to', `default_to TEXT NOT NULL DEFAULT ''`);
  ensureColumn('email_templates', 'default_cc', `default_cc TEXT NOT NULL DEFAULT ''`);
  ensureColumn('sent_emails', 'cc_address', 'cc_address TEXT');
}

function seed() {
  // Idempotent: insert only templates whose `key` is missing. This way a new
  // seeded template (e.g. booking_instruction) is added to an EXISTING db on
  // the next startup, without wiping the admin's edits to other templates.
  const now = new Date().toISOString();
  const exists = db.prepare('SELECT 1 FROM email_templates WHERE key = ?');
  const insert = db.prepare(`
    INSERT INTO email_templates
      (id, key, name, category, subject, body_html, placeholders, is_active,
       is_locked, editable_fields, default_to, default_cc, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'system', 'system', ?, ?)
  `);

  const seeds = [
    {
      key: 'booking_instruction',
      name: 'Booking Instruction',
      category: 'operations',
      subject: 'Booking Instruction {{bookingNo}} / {{shipper}} / {{pol}} – {{pod}}',
      placeholders: ['bookingNo', 'shipper', 'consignee', 'carrier', 'pol', 'pod', 'bookingDate', 'userNote'],
      is_locked: 1,
      editable_fields: ['to', 'cc', 'bcc', 'userNote', 'attachments'],
      default_to: '',
      default_cc: 'ops@asl-logistics.in',
      body_html:
        '<p>Dear Team,</p>' +
        '<p>Please find below the booking instruction <strong>{{bookingNo}}</strong>.</p>' +
        '<table style="border-collapse:collapse">' +
        '<tr><td style="padding:2px 12px 2px 0"><strong>Shipper</strong></td><td>{{shipper}}</td></tr>' +
        '<tr><td style="padding:2px 12px 2px 0"><strong>Consignee</strong></td><td>{{consignee}}</td></tr>' +
        '<tr><td style="padding:2px 12px 2px 0"><strong>Carrier</strong></td><td>{{carrier}}</td></tr>' +
        '<tr><td style="padding:2px 12px 2px 0"><strong>POL</strong></td><td>{{pol}}</td></tr>' +
        '<tr><td style="padding:2px 12px 2px 0"><strong>POD</strong></td><td>{{pod}}</td></tr>' +
        '<tr><td style="padding:2px 12px 2px 0"><strong>Booking Date</strong></td><td>{{bookingDate}}</td></tr>' +
        '</table>' +
        '<p>{{userNote}}</p>' +
        '<p>Regards,<br/>Operations Team</p>',
    },
    {
      key: 'purchase_order',
      name: 'Purchase Order',
      category: 'procurement',
      subject: 'Purchase Order {{orderNumber}} Created',
      placeholders: ['vendorName', 'orderNumber', 'amount', 'deliveryDate'],
      is_locked: 1,
      editable_fields: ['to', 'cc', 'bcc'],
      default_to: '',
      default_cc: '',
      body_html:
        '<h2>Hi {{vendorName}},</h2>' +
        '<p>Purchase Order <strong>{{orderNumber}}</strong> for ' +
        '<span style="color:#dc2626"><strong>{{amount}}</strong></span> has been raised.</p>' +
        '<p>Expected delivery date: <em>{{deliveryDate}}</em>.</p><p>Thank you.</p>',
    },
    {
      key: 'vendor_approval',
      name: 'Vendor Approval Confirmation',
      category: 'procurement',
      subject: 'You have been approved as a vendor',
      placeholders: ['vendorName', 'approvedBy', 'approvalDate'],
      is_locked: 1,
      editable_fields: ['to', 'cc', 'bcc'],
      default_to: '',
      default_cc: '',
      body_html:
        '<h2>Congratulations {{vendorName}}!</h2>' +
        '<p>Your vendor application has been <span style="background-color:#dcfce7"><strong>approved</strong></span> ' +
        'by {{approvedBy}} on {{approvalDate}}.</p><p>You can now receive purchase orders from us.</p>',
    },
    {
      key: 'expense_approval',
      name: 'Expense Request Approval',
      category: 'finance',
      subject: 'Expense request {{status}}',
      placeholders: ['employeeName', 'expenseAmount', 'status', 'approverName'],
      is_locked: 1,
      editable_fields: ['to', 'cc', 'bcc'],
      default_to: '',
      default_cc: '',
      body_html:
        '<h2>Hello {{employeeName}},</h2>' +
        '<p>Your expense request for <strong>{{expenseAmount}}</strong> has been ' +
        '<span style="color:#2563eb"><strong>{{status}}</strong></span> by {{approverName}}.</p>',
    },
    {
      key: 'sales_order',
      name: 'Sales Order Request',
      category: 'sales',
      subject: 'New Sales Order {{orderId}}',
      placeholders: ['customerName', 'orderId', 'totalValue', 'items'],
      is_locked: 1,
      editable_fields: ['to', 'cc', 'bcc'],
      default_to: '',
      default_cc: '',
      body_html:
        '<h2>Dear {{customerName}},</h2>' +
        '<p>We have received your sales order <strong>{{orderId}}</strong>.</p>' +
        '<p>Items: {{items}}</p>' +
        '<p>Total value: <span style="color:#16a34a"><strong>{{totalValue}}</strong></span></p>',
    },
    {
      key: 'cost_sheet',
      name: 'Cost Sheet Notification',
      category: 'finance',
      subject: 'Cost sheet ready for {{projectName}}',
      placeholders: ['projectName', 'sheetId', 'preparedBy', 'link'],
      is_locked: 1,
      editable_fields: ['to', 'cc', 'bcc'],
      default_to: '',
      default_cc: '',
      body_html:
        '<h2>Cost Sheet Ready</h2>' +
        '<p>The cost sheet <strong>{{sheetId}}</strong> for project ' +
        '<em>{{projectName}}</em> has been prepared by {{preparedBy}}.</p>' +
        '<p><a href="{{link}}">View the cost sheet</a></p>',
    },
  ];

  let added = 0;
  for (const s of seeds) {
    if (exists.get(s.key)) continue; // keep admin edits; only add missing keys
    insert.run(
      randomUUID(), s.key, s.name, s.category, s.subject, s.body_html,
      JSON.stringify(s.placeholders), s.is_locked, JSON.stringify(s.editable_fields),
      s.default_to, s.default_cc, now, now,
    );
    added++;
  }
  if (added) console.log(`[db] Seeded ${added} missing email template(s).`);
}

function seedBookings() {
  // Idempotent: insert only bookings whose booking_no is missing.
  const exists = db.prepare('SELECT 1 FROM bookings WHERE booking_no = ?');
  const insert = db.prepare(`
    INSERT INTO bookings (id, booking_no, booking_date, shipper, consignee, carrier, pol, pod, planning_type, contact_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const bookings = [
    ['BKG/EXP/2026/0024', '16/10/2026', 'PCBL Chemical Limited', '—', 'Mediterranean Shipping Co.', 'Mundra', 'Houston', 'Clearing', 'bookings@maersk.com, ops@maersk.com'],
    ['BKG/EXP/2026/0022', '15/10/2026', 'PCBL Chemical Limited', '—', 'Mediterranean Shipping Co.', 'Mundra', 'Houston', 'Forwarding', 'bookings@maersk.com'],
    ['BKG/EXP/2026/0023', '15/10/2026', 'PCBL Chemical Limited', '—', 'Mediterranean Shipping Co.', 'Mundra', 'Houston', 'Clearing', 'bookings@msc.com'],
    ['BKG/EXP/2026/0021', '14/10/2026', 'ABC Pvt Ltd', 'Nippon Steel Corporations', '1111222333', 'Gota port - 001', 'Houston', 'Forwarding', 'ops@abc.example'],
    ['BKG/EXP/2026/0019', '10/10/2026', 'PCBL Chemical Limited', '—', 'Mediterranean Shipping Co.', 'Mundra', 'Houston', 'Forwarding', 'bookings@msc.com'],
    ['BKG/EXP/2026/0020', '03/10/2026', 'SLOGANS FIBC PRIVATE LI...', '—', 'asdsfdhfhgg', 'Mundra', 'Savannah', 'Clearing', 'export@slogans.example'],
    ['BKG/EXP/2026/0017', '02/10/2026', 'Filnder josephinhg', '—', 'Blue Dart', 'Mundra Port - 0002', 'Mundra Port1', 'Forwarding', 'docs@bluedart.example'],
    ['BKG/EXP/2026/0016', '29/09/2026', 'Testing Party Name 03', '—', 'Asian Diamonds', 'Jirva port - 0010', 'Gota port - 001', 'Forwarding', 'ops@asian.example'],
  ];

  let added = 0;
  for (const b of bookings) {
    if (exists.get(b[0])) continue; // b[0] is booking_no
    insert.run(randomUUID(), ...b);
    added++;
  }
  if (added) console.log(`[db] Seeded ${added} missing demo booking(s).`);
}
