// Zero-dependency template engine: placeholder filling, HTML sanitization,
// and a responsive email shell. No external libraries.

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Allowed tags the WYSIWYG editor may produce. */
const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'div', 'span',
  'strong', 'b', 'em', 'i', 'u', 's', 'blockquote',
  'ul', 'ol', 'li', 'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'font',
]);

/** Per-tag allowed attributes. */
const ALLOWED_ATTRS = {
  '*': new Set(['style', 'align', 'color']),
  a: new Set(['href', 'target', 'rel', 'style']),
  img: new Set(['src', 'alt', 'width', 'height', 'style']),
  font: new Set(['color', 'style']),
  td: new Set(['colspan', 'rowspan', 'style', 'align']),
  th: new Set(['colspan', 'rowspan', 'style', 'align']),
};

/**
 * Minimal, allow-list-based HTML sanitizer.
 * - removes <script>, <style>, <iframe>, event handlers (on*), javascript: URLs
 * - strips any tag not in ALLOWED_TAGS (keeps inner text)
 * - strips disallowed attributes
 * This is deliberately conservative; it is NOT a replacement for a hardened
 * library in production, but is safe for this prototype's editor output.
 */
export function sanitize(html) {
  if (!html) return '';
  let out = html;

  // Drop dangerous element blocks entirely (including content).
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, '');

  // Process each remaining tag.
  out = out.replace(/<\s*(\/?)([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (match, slash, tagRaw, attrsRaw) => {
    const tag = tagRaw.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return ''; // strip tag, keep surrounding text
    if (slash) return `</${tag}>`;

    const allowedForTag = ALLOWED_ATTRS[tag] || new Set();
    const globalAllowed = ALLOWED_ATTRS['*'];
    const cleanAttrs = [];

    const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m;
    while ((m = attrRe.exec(attrsRaw)) !== null) {
      const name = m[1].toLowerCase();
      let value = m[3] ?? m[4] ?? m[5] ?? '';
      if (name.startsWith('on')) continue; // event handlers
      if (!(allowedForTag.has(name) || globalAllowed.has(name))) continue;
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) continue;
      // escape quotes in value
      value = value.replace(/"/g, '&quot;');
      cleanAttrs.push(`${name}="${value}"`);
    }
    return cleanAttrs.length ? `<${tag} ${cleanAttrs.join(' ')}>` : `<${tag}>`;
  });

  return out;
}

/** Extract unique {{placeholder}} names from one or more strings. */
export function extractPlaceholders(...sources) {
  const found = new Set();
  for (const src of sources) {
    if (!src) continue;
    for (const mm of String(src).matchAll(PLACEHOLDER_RE)) found.add(mm[1]);
  }
  return [...found];
}

/** Placeholders used but not in the declared allow-list. */
export function findUnknownPlaceholders(subject, bodyHtml, allowed) {
  const used = extractPlaceholders(subject, bodyHtml);
  const set = new Set(allowed || []);
  return used.filter((p) => !set.has(p));
}

function escapeValue(v) {
  // Values are inserted as text; escape HTML-special chars to prevent injection
  // through data (the admin's markup is already sanitized separately).
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fill(template, data) {
  return template.replace(PLACEHOLDER_RE, (_all, name) => {
    const v = data?.[name];
    return v === undefined || v === null ? '' : escapeValue(v);
  });
}

/** Render a stored template + data into { subject, html }. */
export function render(subjectTemplate, bodyHtmlTemplate, data) {
  const subject = fill(String(subjectTemplate || ''), data || {});
  const safeBody = sanitize(String(bodyHtmlTemplate || ''));
  const filledBody = fill(safeBody, data || {});
  const html = wrapInShell(filledBody);
  return { subject, html };
}

/** Render just the inner body (for the editor preview, without the full shell). */
export function renderBodyOnly(bodyHtmlTemplate, data) {
  const safeBody = sanitize(String(bodyHtmlTemplate || ''));
  return fill(safeBody, data || {});
}

function wrapInShell(bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#ffffff;border-radius:8px;padding:32px;">
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`;
}
