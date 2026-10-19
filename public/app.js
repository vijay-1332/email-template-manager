// Vanilla-JS single-page app. No framework / CDN needed.
const API = '';
const app = document.getElementById('app');
const roleSelect = document.getElementById('roleSelect');

let role = 'super_admin';
roleSelect.addEventListener('change', () => { role = roleSelect.value; render(); });

function headers() {
  return { 'Content-Type': 'application/json', 'x-user-role': role, 'x-user-id': 'demo-admin' };
}
async function api(path, opts = {}) {
  const res = await fetch(API + path, { headers: headers(), ...opts });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// ---------- routing ----------
let view = 'list';
let editing = null; // template object or {} for new

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    view = tab.dataset.view;
    editing = null;
    render();
  });
});

function render() {
  if (editing !== null) return renderEditor();
  if (view === 'list') return renderList();
  if (view === 'send') return renderSend();
  if (view === 'log') return renderLog();
}

// ---------- List view ----------
async function renderList() {
  app.innerHTML = `<div class="empty">Loading templates…</div>`;
  let templates;
  try { templates = await api('/api/templates'); }
  catch (e) { app.innerHTML = `<div class="empty">Error: ${e.message}</div>`; return; }

  const canEdit = role === 'super_admin';
  app.innerHTML = `
    <div class="hint">
      Developers reference a template only by its <code class="inline">key</code> — the Super Admin owns the design here.
      ${canEdit ? '' : '<strong>Viewer role:</strong> editing is disabled (switch role to <code class="inline">super_admin</code> top-right).'}
    </div>
    <div class="toolbar">
      <h2 style="margin:0;font-size:18px;">Email Templates (${templates.length})</h2>
      <button class="btn btn-primary" id="addBtn" ${canEdit ? '' : 'disabled'}>+ Add Template</button>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Key</th><th>Category</th><th>Placeholders</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${templates.map((t) => `
          <tr>
            <td><strong>${esc(t.name)}</strong></td>
            <td><span class="key-chip">${esc(t.key)}</span></td>
            <td><span class="cat-chip">${esc(t.category)}</span></td>
            <td>${t.placeholders.map((p) => `<span class="ph-chip">{{${esc(p)}}}</span>`).join(' ')}</td>
            <td>${t.is_active ? '<span class="badge-active">● Active</span>' : '<span class="badge-inactive">○ Inactive</span>'}</td>
            <td class="row-actions">
              <button class="btn btn-secondary btn-sm" data-edit="${t.id}">${canEdit ? 'Edit' : 'View'}</button>
              ${canEdit ? `<button class="btn btn-danger btn-sm" data-del="${t.id}" data-name="${esc(t.name)}">Delete</button>` : ''}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  const addBtn = document.getElementById('addBtn');
  if (addBtn) addBtn.addEventListener('click', () => { editing = blankTemplate(); render(); });

  app.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', async () => { editing = await api('/api/templates/' + b.dataset.edit); render(); }));

  app.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`Delete template "${b.dataset.name}"?`)) return;
      try { await api('/api/templates/' + b.dataset.del, { method: 'DELETE' }); toast('Template deleted'); render(); }
      catch (e) { toast(e.message, true); }
    }));
}

function blankTemplate() {
  return { id: null, key: '', name: '', category: 'general', subject: '', body_html: '<p>Hello {{name}},</p><p>Write your message…</p>', placeholders: ['name'], is_active: 1 };
}

// ---------- Editor view ----------
function renderEditor() {
  const t = editing;
  const isNew = !t.id;
  const readOnly = role !== 'super_admin';

  app.innerHTML = `
    <div class="editor-head">
      <h2>${isNew ? 'Create' : (readOnly ? 'View' : 'Edit')} Template</h2>
      <div class="editor-actions">
        <button class="btn btn-secondary" id="cancelBtn">← Back</button>
        <button class="btn btn-primary" id="saveBtn" ${readOnly ? 'disabled' : ''}>💾 Save</button>
      </div>
    </div>
    <div class="editor-grid">
      <!-- LEFT: form + editor -->
      <div class="card">
        <div class="field">
          <label>Template Name</label>
          <input id="f-name" value="${esc(t.name)}" ${readOnly ? 'disabled' : ''} placeholder="Purchase Order" />
        </div>
        <div class="field">
          <label>Key (developer reference — lowercase_with_underscores)</label>
          <input id="f-key" value="${esc(t.key)}" ${isNew ? '' : 'disabled'} placeholder="purchase_order" />
          <small>Developers call <code class="inline">sendTemplatedEmail('${esc(t.key) || 'key'}', ...)</code></small>
        </div>
        <div class="field">
          <label>Category</label>
          <input id="f-category" value="${esc(t.category)}" ${readOnly ? 'disabled' : ''} placeholder="procurement" />
        </div>
        <div class="field">
          <label>Allowed Placeholders (comma separated)</label>
          <input id="f-placeholders" value="${esc(t.placeholders.join(', '))}" ${readOnly ? 'disabled' : ''} placeholder="orderNumber, amount" />
          <small>Only these may be used as <code class="inline">{{variable}}</code>.</small>
          <div class="placeholder-bar" id="phBar"></div>
        </div>
        <div class="field">
          <label>Subject</label>
          <input id="f-subject" value="${esc(t.subject)}" ${readOnly ? 'disabled' : ''} placeholder="Purchase Order {{orderNumber}} Created" />
        </div>
        <div class="field">
          <label>Body (WYSIWYG — no HTML needed)</label>
          <div class="wysiwyg-toolbar" id="toolbar" ${readOnly ? 'style="display:none"' : ''}>
            <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
            <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
            <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
            <select data-block title="Heading">
              <option value="p">Paragraph</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
            </select>
            <button type="button" data-cmd="insertUnorderedList" title="Bullet list">• List</button>
            <label title="Text color" style="display:flex;align-items:center;gap:3px;">🎨<input type="color" id="fgColor" value="#dc2626" /></label>
            <label title="Highlight" style="display:flex;align-items:center;gap:3px;">🖍️<input type="color" id="bgColor" value="#fff3cd" /></label>
            <button type="button" data-cmd="removeFormat" title="Clear formatting">⌫ Clear</button>
          </div>
          <div class="editor-area" id="editor" ${readOnly ? '' : 'contenteditable="true"'}></div>
        </div>
      </div>

      <!-- RIGHT: live preview -->
      <div class="card">
        <h3>Live Preview</h3>
        <div class="preview-toggle">
          <button class="btn btn-secondary btn-sm" data-device="desktop">🖥️ Desktop</button>
          <button class="btn btn-secondary btn-sm" data-device="mobile">📱 Mobile</button>
        </div>
        <div class="field">
          <label>Subject preview</label>
          <div id="subjectPreview" style="padding:8px 11px;background:#f8fafc;border-radius:6px;font-size:14px;"></div>
        </div>
        <div class="preview-frame device-desktop" id="previewWrap">
          <iframe id="previewFrame"></iframe>
        </div>
        <small style="display:block;margin-top:8px;color:#6b7280;">Preview uses sample values for each placeholder.</small>
      </div>
    </div>`;

  const editor = document.getElementById('editor');
  editor.innerHTML = t.body_html;

  // toolbar commands
  if (!readOnly) {
    document.getElementById('toolbar').querySelectorAll('[data-cmd]').forEach((b) =>
      b.addEventListener('mousedown', (e) => { e.preventDefault(); document.execCommand(b.dataset.cmd, false, null); editor.focus(); schedulePreview(); }));
    document.querySelector('[data-block]').addEventListener('change', (e) => { document.execCommand('formatBlock', false, e.target.value); editor.focus(); schedulePreview(); });
    document.getElementById('fgColor').addEventListener('input', (e) => { document.execCommand('foreColor', false, e.target.value); editor.focus(); schedulePreview(); });
    document.getElementById('bgColor').addEventListener('input', (e) => { document.execCommand('hiliteColor', false, e.target.value) || document.execCommand('backColor', false, e.target.value); editor.focus(); schedulePreview(); });
    editor.addEventListener('input', schedulePreview);
    document.getElementById('f-subject').addEventListener('input', schedulePreview);
    document.getElementById('f-placeholders').addEventListener('input', () => { renderPhBar(); schedulePreview(); });
  }

  // device toggle
  app.querySelectorAll('[data-device]').forEach((b) =>
    b.addEventListener('click', () => {
      const wrap = document.getElementById('previewWrap');
      wrap.className = 'preview-frame ' + (b.dataset.device === 'mobile' ? 'device-mobile' : 'device-desktop');
    }));

  document.getElementById('cancelBtn').addEventListener('click', () => { editing = null; render(); });
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn && !readOnly) saveBtn.addEventListener('click', saveTemplate);

  renderPhBar();
  schedulePreview();
}

function currentPlaceholders() {
  return document.getElementById('f-placeholders').value.split(',').map((s) => s.trim()).filter(Boolean);
}

function renderPhBar() {
  const bar = document.getElementById('phBar');
  const readOnly = role !== 'super_admin';
  const phs = currentPlaceholders();
  bar.innerHTML = phs.length
    ? phs.map((p) => `<span class="ph-chip" data-ph="${esc(p)}" title="Click to insert into body">{{${esc(p)}}}</span>`).join('')
    : '<small style="color:#9ca3af">No placeholders defined yet.</small>';
  if (!readOnly) {
    bar.querySelectorAll('[data-ph]').forEach((chip) =>
      chip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const editor = document.getElementById('editor');
        editor.focus();
        document.execCommand('insertText', false, `{{${chip.dataset.ph}}}`);
        schedulePreview();
      }));
  }
}

// sample values for preview
function sampleData(placeholders) {
  const samples = {
    vendorName: 'Acme Supplies', orderNumber: 'PO-1042', amount: '$12,500', deliveryDate: '2026-11-01',
    approvedBy: 'Jane Doe', approvalDate: '2026-10-19', employeeName: 'John Smith', expenseAmount: '$320',
    status: 'Approved', approverName: 'Sarah Lee', customerName: 'Globex Inc', orderId: 'SO-7781',
    totalValue: '$48,900', items: '3 × Widget, 2 × Gadget', projectName: 'Skyline Tower',
    sheetId: 'CS-220', preparedBy: 'Finance Team', link: 'https://example.com/cost-sheet/CS-220', name: 'there',
  };
  const out = {};
  for (const p of placeholders) out[p] = samples[p] ?? `«${p}»`;
  return out;
}

let previewTimer = null;
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 250); }

async function updatePreview() {
  const subject = document.getElementById('f-subject').value;
  const body_html = document.getElementById('editor').innerHTML;
  const data = sampleData(currentPlaceholders());
  try {
    const { subject: s, html } = await api('/api/templates/preview', { method: 'POST', body: JSON.stringify({ subject, body_html, sampleData: data }) });
    document.getElementById('subjectPreview').textContent = s || '(empty subject)';
    document.getElementById('previewFrame').srcdoc = html;
  } catch (e) { /* ignore transient */ }
}

async function saveTemplate() {
  const payload = {
    key: document.getElementById('f-key').value.trim(),
    name: document.getElementById('f-name').value.trim(),
    category: document.getElementById('f-category').value.trim() || 'general',
    subject: document.getElementById('f-subject').value,
    body_html: document.getElementById('editor').innerHTML,
    placeholders: currentPlaceholders(),
    is_active: true,
  };
  try {
    if (editing.id) await api('/api/templates/' + editing.id, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/templates', { method: 'POST', body: JSON.stringify(payload) });
    toast('Template saved ✓');
    editing = null; view = 'list'; render();
  } catch (e) { toast(e.message, true); }
}

// ---------- Send demo view ----------
async function renderSend() {
  app.innerHTML = `<div class="empty">Loading…</div>`;
  const templates = await api('/api/templates');
  app.innerHTML = `
    <div class="hint">
      This simulates an app event (e.g. "Purchase Order created"). The code only knows the <code class="inline">key</code> + data —
      it never touches HTML. Try it, then check the <strong>Sent Log</strong> tab.
    </div>
    <div class="editor-grid">
      <div class="card">
        <h3>Send a Templated Email</h3>
        <div class="field">
          <label>Template</label>
          <select id="s-key">
            ${templates.map((t) => `<option value="${t.key}">${esc(t.name)} (${t.key})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Recipient</label>
          <input id="s-to" value="recipient@example.com" />
        </div>
        <div id="s-fields"></div>
        <button class="btn btn-primary" id="sendBtn">📤 Send Email</button>
      </div>
      <div class="card">
        <h3>Developer code (what this does)</h3>
        <pre id="codeSnippet" style="background:#0f172a;color:#e2e8f0;padding:16px;border-radius:8px;overflow:auto;font-size:13px;"></pre>
        <div id="sendResult"></div>
      </div>
    </div>`;

  const map = Object.fromEntries(templates.map((t) => [t.key, t]));
  const keySel = document.getElementById('s-key');

  function renderFields() {
    const t = map[keySel.value];
    document.getElementById('s-fields').innerHTML = t.placeholders.map((p) => {
      const sample = sampleData([p])[p];
      return `<div class="field"><label>${esc(p)}</label><input data-ph="${esc(p)}" value="${esc(sample)}" /></div>`;
    }).join('');
    updateSnippet();
  }
  function collectData() {
    const data = {};
    document.querySelectorAll('[data-ph]').forEach((i) => (data[i.dataset.ph] = i.value));
    return data;
  }
  function updateSnippet() {
    const t = map[keySel.value];
    const data = collectData();
    document.getElementById('codeSnippet').textContent =
      `await sendTemplatedEmail(\n  '${t.key}',\n  '${document.getElementById('s-to').value}',\n  ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')}\n);`;
  }

  keySel.addEventListener('change', renderFields);
  document.getElementById('s-to').addEventListener('input', updateSnippet);
  document.getElementById('s-fields').addEventListener('input', updateSnippet);
  renderFields();

  document.getElementById('sendBtn').addEventListener('click', async () => {
    try {
      const res = await api('/api/send', { method: 'POST', body: JSON.stringify({ key: keySel.value, to: document.getElementById('s-to').value, data: collectData() }) });
      document.getElementById('sendResult').innerHTML =
        `<div class="hint" style="margin-top:14px;background:#dcfce7;border-color:#86efac;color:#166534;">
           ✅ Sent! Subject: <strong>${esc(res.subject)}</strong><br/>Check the server console + Sent Log tab.</div>`;
      toast('Email sent ✓');
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- Sent log view ----------
async function renderLog() {
  app.innerHTML = `<div class="empty">Loading…</div>`;
  const log = await api('/api/send/log');
  if (!log.length) { app.innerHTML = `<div class="empty">No emails sent yet. Try the Send Demo tab.</div>`; return; }
  app.innerHTML = `
    <h2 style="font-size:18px;">Sent Emails (${log.length})</h2>
    <table>
      <thead><tr><th>When</th><th>Template</th><th>To</th><th>Subject</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${log.map((e, i) => `
          <tr>
            <td style="font-size:12px;color:#64748b;">${new Date(e.created_at).toLocaleString()}</td>
            <td><span class="key-chip">${esc(e.template_key)}</span></td>
            <td>${esc(e.to_address)}</td>
            <td>${esc(e.subject)}</td>
            <td>${e.status === 'sent' ? '<span class="badge-active">✓ sent</span>' : '<span style="color:#b91c1c">✗ failed</span>'}</td>
            <td><button class="btn btn-secondary btn-sm" data-view-html="${i}">View</button></td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div id="htmlViewer"></div>`;
  app.querySelectorAll('[data-view-html]').forEach((b) =>
    b.addEventListener('click', () => {
      const e = log[Number(b.dataset.viewHtml)];
      document.getElementById('htmlViewer').innerHTML =
        `<div class="card" style="margin-top:16px;"><h3>Rendered email — ${esc(e.subject)}</h3>
         <div class="preview-frame device-desktop"><iframe style="width:100%;height:440px;border:none;" srcdoc="${esc(e.body_html)}"></iframe></div></div>`;
      document.getElementById('htmlViewer').scrollIntoView({ behavior: 'smooth' });
    }));
}

// ---------- utils ----------
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

render();
