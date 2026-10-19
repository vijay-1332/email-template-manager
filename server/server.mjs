// Zero-dependency HTTP server (node:http). Serves the JSON API and the
// static single-page frontend from ../public.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

import { db, initDb } from './db.mjs';
import { render, sanitize, findUnknownPlaceholders } from './templateEngine.mjs';
import { sendTemplatedEmail, listSentEmails, TemplateNotFoundError } from './emailService.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT ?? 4000);

initDb();

// ---------- helpers ----------
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-user-role,x-user-id',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

function isSuperAdmin(req) {
  return req.headers['x-user-role'] === 'super_admin';
}

function rowToTemplate(row) {
  return { ...row, placeholders: JSON.parse(row.placeholders || '[]') };
}

function validatePayload(body) {
  if (!body?.key || !/^[a-z0-9_]+$/.test(body.key))
    return 'key is required and must be lowercase letters/numbers/underscores';
  if (!body?.name) return 'name is required';
  if (!body?.subject) return 'subject is required';
  if (typeof body?.body_html !== 'string') return 'body_html is required';
  const placeholders = Array.isArray(body.placeholders) ? body.placeholders : [];
  const unknown = findUnknownPlaceholders(body.subject, body.body_html, placeholders);
  if (unknown.length) return `Unknown placeholders not in allow-list: ${unknown.join(', ')}`;
  return null;
}

// ---------- static files ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') return sendJson(res, 204, {});

  // ===== API =====
  if (path.startsWith('/api/')) {
    try {
      // health
      if (path === '/api/health') return sendJson(res, 200, { ok: true });

      // ---- templates ----
      if (path === '/api/templates' && method === 'GET') {
        const rows = db.prepare('SELECT * FROM email_templates ORDER BY category, name').all();
        return sendJson(res, 200, rows.map(rowToTemplate));
      }

      if (path === '/api/templates/preview' && method === 'POST') {
        const body = await readBody(req);
        return sendJson(res, 200, render(body.subject ?? '', body.body_html ?? '', body.sampleData ?? {}));
      }

      if (path === '/api/templates' && method === 'POST') {
        if (!isSuperAdmin(req)) return sendJson(res, 403, { error: 'super admin role required' });
        const body = await readBody(req);
        const err = validatePayload(body);
        if (err) return sendJson(res, 400, { error: err });
        if (db.prepare('SELECT 1 FROM email_templates WHERE key = ?').get(body.key))
          return sendJson(res, 409, { error: `Template key "${body.key}" already exists` });

        const now = new Date().toISOString();
        const id = randomUUID();
        const user = req.headers['x-user-id'] ?? 'super_admin';
        db.prepare(
          `INSERT INTO email_templates (id,key,name,category,subject,body_html,placeholders,is_active,created_by,updated_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(id, body.key, body.name, body.category ?? 'general', body.subject, sanitize(body.body_html),
          JSON.stringify(body.placeholders ?? []), body.is_active === false ? 0 : 1, user, user, now, now);
        return sendJson(res, 201, rowToTemplate(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(id)));
      }

      // /api/templates/:id  and sub-routes
      const tplMatch = path.match(/^\/api\/templates\/([^/]+)(\/versions|\/rollback\/(\d+))?$/);
      if (tplMatch) {
        const id = tplMatch[1];
        const sub = tplMatch[2];

        if (sub === '/versions' && method === 'GET') {
          const rows = db.prepare('SELECT * FROM email_template_versions WHERE template_id = ? ORDER BY version_no DESC').all(id);
          return sendJson(res, 200, rows);
        }

        if (sub && sub.startsWith('/rollback') && method === 'POST') {
          if (!isSuperAdmin(req)) return sendJson(res, 403, { error: 'super admin role required' });
          const versionNo = Number(tplMatch[3]);
          const version = db.prepare('SELECT * FROM email_template_versions WHERE template_id = ? AND version_no = ?').get(id, versionNo);
          if (!version) return sendJson(res, 404, { error: 'Version not found' });
          db.prepare('UPDATE email_templates SET subject = ?, body_html = ?, updated_at = ? WHERE id = ?')
            .run(version.subject, version.body_html, new Date().toISOString(), id);
          return sendJson(res, 200, rowToTemplate(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(id)));
        }

        if (!sub && method === 'GET') {
          const row = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(id);
          if (!row) return sendJson(res, 404, { error: 'Template not found' });
          return sendJson(res, 200, rowToTemplate(row));
        }

        if (!sub && method === 'PUT') {
          if (!isSuperAdmin(req)) return sendJson(res, 403, { error: 'super admin role required' });
          const existing = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(id);
          if (!existing) return sendJson(res, 404, { error: 'Template not found' });
          const body = await readBody(req);
          const err = validatePayload({ ...body, key: body.key ?? existing.key });
          if (err) return sendJson(res, 400, { error: err });

          const now = new Date().toISOString();
          const user = req.headers['x-user-id'] ?? 'super_admin';
          // snapshot current state as a version
          const vc = db.prepare('SELECT COUNT(*) AS c FROM email_template_versions WHERE template_id = ?').get(id);
          db.prepare(`INSERT INTO email_template_versions (id,template_id,version_no,subject,body_html,edited_by,created_at) VALUES (?,?,?,?,?,?,?)`)
            .run(randomUUID(), id, vc.c + 1, existing.subject, existing.body_html, user, now);
          db.prepare(`UPDATE email_templates SET name=?,category=?,subject=?,body_html=?,placeholders=?,is_active=?,updated_by=?,updated_at=? WHERE id=?`)
            .run(body.name ?? existing.name, body.category ?? existing.category, body.subject, sanitize(body.body_html),
              JSON.stringify(body.placeholders ?? JSON.parse(existing.placeholders)), body.is_active === false ? 0 : 1, user, now, id);
          return sendJson(res, 200, rowToTemplate(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(id)));
        }

        if (!sub && method === 'DELETE') {
          if (!isSuperAdmin(req)) return sendJson(res, 403, { error: 'super admin role required' });
          const info = db.prepare('DELETE FROM email_templates WHERE id = ?').run(id);
          if (info.changes === 0) return sendJson(res, 404, { error: 'Template not found' });
          return sendJson(res, 204, {});
        }
      }

      // ---- send (demo) ----
      if (path === '/api/send' && method === 'POST') {
        const body = await readBody(req);
        if (!body.key || !body.to) return sendJson(res, 400, { error: 'key and to are required' });
        try {
          const result = await sendTemplatedEmail(body.key, body.to, body.data ?? {});
          return sendJson(res, 200, { ok: true, ...result });
        } catch (e) {
          if (e instanceof TemplateNotFoundError) return sendJson(res, 404, { error: e.message });
          return sendJson(res, 500, { error: e instanceof Error ? e.message : 'Send failed' });
        }
      }

      if (path === '/api/send/log' && method === 'GET') {
        return sendJson(res, 200, listSentEmails());
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
      return sendJson(res, 500, { error: e instanceof Error ? e.message : 'Server error' });
    }
  }

  // ===== static frontend =====
  return serveStatic(res, path);
});

server.listen(PORT, () => {
  console.log(`\n🚀 Email-template prototype running at http://localhost:${PORT}`);
  console.log(`   Open that URL in your browser.\n`);
});
