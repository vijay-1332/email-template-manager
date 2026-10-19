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
      id           TEXT PRIMARY KEY,
      key          TEXT UNIQUE NOT NULL,
      name         TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'general',
      subject      TEXT NOT NULL,
      body_html    TEXT NOT NULL,
      placeholders TEXT NOT NULL DEFAULT '[]',
      is_active    INTEGER NOT NULL DEFAULT 1,
      created_by   TEXT NOT NULL DEFAULT 'system',
      updated_by   TEXT NOT NULL DEFAULT 'system',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
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
      subject      TEXT NOT NULL,
      body_html    TEXT NOT NULL,
      status       TEXT NOT NULL,
      error        TEXT,
      created_at   TEXT NOT NULL
    );
  `);
  seed();
}

function seed() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM email_templates').get();
  if (row.c > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO email_templates
      (id, key, name, category, subject, body_html, placeholders, is_active, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'system', 'system', ?, ?)
  `);

  const seeds = [
    {
      key: 'purchase_order',
      name: 'Purchase Order',
      category: 'procurement',
      subject: 'Purchase Order {{orderNumber}} Created',
      placeholders: ['vendorName', 'orderNumber', 'amount', 'deliveryDate'],
      body_html:
        '<h2>Hi {{vendorName}},</h2>' +
        '<p>Purchase Order <strong>{{orderNumber}}</strong> for ' +
        '<span style="color:#dc2626"><strong>{{amount}}</strong></span> has been raised.</p>' +
        '<p>Expected delivery date: <em>{{deliveryDate}}</em>.</p>' +
        '<p>Thank you.</p>',
    },
    {
      key: 'vendor_approval',
      name: 'Vendor Approval Confirmation',
      category: 'procurement',
      subject: 'You have been approved as a vendor',
      placeholders: ['vendorName', 'approvedBy', 'approvalDate'],
      body_html:
        '<h2>Congratulations {{vendorName}}!</h2>' +
        '<p>Your vendor application has been <span style="background-color:#dcfce7"><strong>approved</strong></span> ' +
        'by {{approvedBy}} on {{approvalDate}}.</p>' +
        '<p>You can now receive purchase orders from us.</p>',
    },
    {
      key: 'expense_approval',
      name: 'Expense Request Approval',
      category: 'finance',
      subject: 'Expense request {{status}}',
      placeholders: ['employeeName', 'expenseAmount', 'status', 'approverName'],
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
      body_html:
        '<h2>Cost Sheet Ready</h2>' +
        '<p>The cost sheet <strong>{{sheetId}}</strong> for project ' +
        '<em>{{projectName}}</em> has been prepared by {{preparedBy}}.</p>' +
        '<p><a href="{{link}}">View the cost sheet</a></p>',
    },
  ];

  for (const s of seeds) {
    insert.run(randomUUID(), s.key, s.name, s.category, s.subject, s.body_html, JSON.stringify(s.placeholders), now, now);
  }
  console.log(`[db] Seeded ${seeds.length} email templates.`);
}
