# Database-Driven Email Templates — Full Prototype

A complete, **zero-dependency** prototype where **email templates live in the database** and a **Super Admin edits them via a WYSIWYG UI** — so developers never touch email-template code again.

> Built with only Node.js built-ins (`node:http`, `node:sqlite`, `node:crypto`) and vanilla JS on the frontend — **no `npm install` required**. Runs on Node 22+.

## What this demonstrates

- **CRUD** for email templates (create / read / update / delete)
- **WYSIWYG editing** (bold, italic, underline, headings, text color, highlight) — no HTML by hand
- **Placeholders** like `{{orderNumber}}` inserted from clickable chips, validated against an allow-list
- **Live preview** (desktop + mobile) with realistic sample data
- **`sendTemplatedEmail(key, to, data)`** — one function developers reuse for every email type
- **Version history** snapshot on every edit + rollback endpoint
- **HTML sanitization** (strips scripts/handlers) + **role guard** (only `super_admin` can write)
- A demo **"Send"** screen covering the 5 business emails:
  purchase order, vendor approval, expense approval, sales order, cost sheet
- A **Sent Log** showing each rendered email

## Run it

```bash
cd server
node server.mjs
```

Then open **http://localhost:4000** in your browser. The SQLite DB is created and seeded automatically on first run.

> Node 22+ required (uses the built-in `node:sqlite` module). If you see a warning
> `ExperimentalWarning: SQLite is an experimental feature`, that's expected and harmless.

## The four tabs

| Tab | What it shows |
|-----|---------------|
| 🚢 **Booking Instruction** | A real-world module list (like your screenshots). Click the **✉️ mail icon** on a row to open the **low-friction Send Mail modal** — subject & body are auto-filled from the row and **locked**; the user only confirms recipients and may add an optional note. |
| 📋 **Templates** | CRUD table. Click **Edit** to open the WYSIWYG + live preview. Switch the top-right **Role** to `viewer` to see the super-admin guard in action. |
| 📤 **Send Demo** | Pick a template, fill placeholder values, hit Send. Shows the exact `sendTemplatedEmail(...)` call a developer would write. |
| 🧾 **Sent Log** | Every email sent, with a **View** button to see the final rendered HTML. |

## Low-friction locked-template flow (the Booking Instruction tab)

The core idea: the user shouldn't re-type data the system already knows. Clicking ✉️ on a
record does this:

```
Record row (system knows)     Locked template (Super Admin owns)     User (types almost nothing)
  bookingNo, shipper,    +      subject + body with {{...}}      +     confirm To/CC
  carrier, POL, POD...          (READ-ONLY to the user)                + optional note
          │                              │                                    │
          └──────────────► server renders subject + body ◄──────────────────┘
                                         │
                      prefilled, locked modal → user clicks Send
```

**How "fixed per module, not alterable by the user" is enforced:**

- Templates have `is_locked` + an `editable_fields` allow-list (e.g. `["to","cc","bcc","userNote","attachments"]`).
- Subject & body come back **read-only** (body shown in an iframe preview) — there's no editable textarea.
- On send, the server **re-renders** subject/body from the locked template and **ignores any
  subject/body the client sends**. Verified: a request with `subject:"HACKED"` still sends the
  template's subject. The user can only influence allow-listed fields.

**New endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/bookings` | the demo module's records |
| `GET /api/compose?key=&recordId=` | prefilled, locked subject/body + editable-field config for a record |
| `POST /api/compose/send` | tamper-proof send: re-renders from the locked template, honors only allow-listed fields |

**Wiring a new module into this flow** = add a loader in `server/composeService.mjs`
(`MODULE_SOURCES[key]`) that maps a record to the template's placeholders. No template code,
and the end user still can't alter the content.

## Architecture

```
Browser (vanilla JS SPA)            Node (node:http)                 node:sqlite
┌────────────────────┐              ┌─────────────────────┐          ┌──────────────┐
│ Template CRUD UI    │   REST       │ /api/templates CRUD │  SQL     │ email_        │
│ WYSIWYG editor      │  ─────────►  │ /api/templates/     │ ───────► │ templates     │
│ Live preview (iframe)              │   preview           │          │ email_template│
│ Send demo screen    │              │ /api/send           │          │ _versions     │
│ Sent log            │              │ template engine     │          │ sent_emails   │
└────────────────────┘              │ mock mailer         │          └──────────────┘
                                     └─────────────────────┘
```

## Key files

| File | Purpose |
|------|---------|
| `server/server.mjs` | HTTP server + router + static file serving + CRUD/preview/send routes |
| `server/db.mjs` | SQLite schema + seed data (the 5 business templates) |
| `server/templateEngine.mjs` | placeholder replacement, HTML sanitization, responsive email shell |
| `server/mailer.mjs` | provider-agnostic `sendEmail` (mock adapter; Nodemailer example in comments) |
| `server/emailService.mjs` | **`sendTemplatedEmail(key, to, data)`** — the developer-facing API |
| `public/index.html` | app shell + tabs |
| `public/app.js` | the whole SPA: CRUD, WYSIWYG, placeholders, preview, send, log |
| `public/styles.css` | styling |

## The developer's whole job

```js
// When a purchase order is created, anywhere in the app:
await sendTemplatedEmail('purchase_order', 'vendor@acme.com', {
  orderNumber: 'PO-1042',
  vendorName: 'Acme Supplies',
  amount: '$12,500',
  deliveryDate: '2026-11-01',
});
```

That's it. The HTML design is owned entirely by the Super Admin in the UI — add a new
email type by creating a template in the UI + one `sendTemplatedEmail('new_key', ...)` call.

## Going to production (what you'd swap)

| Prototype piece | Production replacement |
|-----------------|------------------------|
| `node:sqlite` | PostgreSQL / MySQL (keep the same schema) |
| `node:http` router | Express / Fastify / Nest |
| Mock mailer | Nodemailer (SMTP) or Resend / SES (see `mailer.mjs` comments) |
| `contenteditable` editor | A hardened rich-text editor (TipTap, Quill) |
| Header-based role check | Real JWT/session auth with a `super_admin` role claim |
| Custom sanitizer | A vetted library like `sanitize-html` + a CSS inliner like `juice` |
```
