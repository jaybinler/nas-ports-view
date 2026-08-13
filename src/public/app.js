// nas-ports-view · 前端渲染逻辑
// 拉取 /api/containers 并渲染为磷光监控台表格

const tbody = document.getElementById('tbody');
const refreshBtn = document.getElementById('refresh');
const autoChk = document.getElementById('auto');
const hostIpEl = document.getElementById('hostIp');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('countReadout');
const updatedEl = document.getElementById('updatedReadout');
const signalLed = document.getElementById('signalLed');
const signalText = document.getElementById('signalText');

let timer = null;
let firstRender = true;
const PREVIEW = 5;          // 端口超过此数则折叠，点击 +N 展开
const expanded = new Set(); // 已展开的容器 id，跨刷新保留

async function load() {
  try {
    const r = await fetch('/api/containers');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    setSignal(true);
    render(data);
  } catch (e) {
    setSignal(false);
    tbody.innerHTML = `<tr class="error-row"><td colspan="5">SIGNAL LOST - ${esc(e.message)}</td></tr>`;
    updatedEl.textContent = 'last scan: error';
  }
}

function setSignal(ok) {
  signalLed.className = 'led ' + (ok ? 'led-green' : 'led-red');
  signalText.textContent = ok ? 'signal ok' : 'signal lost';
}

function render(data) {
  hostIpEl.textContent = data.hostIp || '-.-.-.-';
  const cs = data.containers || [];
  countEl.textContent = 'containers: ' + cs.length;
  tbody.innerHTML = '';

  if (cs.length === 0) {
    emptyEl.hidden = false;
    updatedEl.textContent = 'last scan: ' + now();
    firstRender = false;
    return;
  }
  emptyEl.hidden = true;

  tbody.innerHTML = cs.map((c, i) => rowHTML(c, i)).join('');
  updatedEl.textContent = 'last scan: ' + now();
  firstRender = false;
}

function rowHTML(c, i) {
  const anim = firstRender
    ? ` row-in" style="animation-delay:${Math.min(i * 45, 650)}ms`
    : '"';
  const nameCell = c.service !== c.containerName
    ? `<span class="svc-name">${esc(c.service)}</span><span class="svc-sub">${esc(c.containerName)}</span>`
    : `<span class="svc-name">${esc(c.service)}</span>`;
  const ipCell = c.ip ? `<span class="ip-val">${esc(c.ip)}</span>` : `<span class="dim">-</span>`;
  const portsHtml = portCell(c.ports, c.networkMode, c.id);
  const collapsed = c.ports && c.ports.length > PREVIEW && !expanded.has(c.id);
  const portsCls = collapsed ? 'col-ports collapsed' : 'col-ports';
  return `<tr class="row${anim}>
      <td class="col-svc">${nameCell}</td>
      <td class="col-ip">${ipCell}</td>
      <td class="col-st">${statusCell(c)}</td>
      <td class="col-net">${networkCell(c)}</td>
      <td class="${portsCls}">${portsHtml}</td>
    </tr>`;
}

function networkCell(c) {
  const m = c.networkMode || '';
  if (m === 'host') return '<span class="net net-host">host</span>';
  if (m === 'bridge') return '<span class="net">bridge</span>';
  if (m === 'none') return '<span class="net dim">none</span>';
  if (m.startsWith('container:')) return '<span class="net dim">container</span>';
  return `<span class="net">${esc(m)}</span>`;
}

function statusCell(c) {
  const cls = c.status === 'running'
    ? 'led-green pulse'
    : c.status === 'paused'
      ? 'led-amber'
      : 'led-red';
  let label = c.statusText;
  if (c.health) label += ' · ' + c.health;
  return `<span class="status"><span class="led ${cls}"></span>${esc(label)}</span>`;
}

function portCell(ports, networkMode, id) {
  if (!ports || ports.length === 0) {
    if (networkMode && networkMode.startsWith('container:')) {
      const ref = networkMode.slice('container:'.length);
      return `<span class="dim">↳ shares ${esc(ref.slice(0, 16))}</span>`;
    }
    return `<span class="dim">-</span>`;
  }
  const chips = ports
    .map((p) => {
      const proto = p.proto || 'tcp';
      if (p.kind === 'host-listen') {
        return `<span class="port ${proto} host" title="host 模式监听 ${esc(p.listenAddr || '')}:${p.port}">${p.port}/${proto}</span>`;
      }
      if (p.kind === 'mapped') {
        return `<span class="port ${proto} mapped" title="${esc(p.hostIp || '0.0.0.0')}:${p.hostPort} -> ${p.containerPort}/${proto}">${p.hostPort}->${p.containerPort}/${proto}</span>`;
      }
      return `<span class="port ${proto} internal" title="未发布，仅容器内部">· ${p.containerPort}/${proto}</span>`;
    })
    .join('');
  if (ports.length <= PREVIEW) return chips;
  const more = ports.length - PREVIEW;
  const isOpen = expanded.has(id);
  return `${chips}<span class="port-more" tabindex="0" role="button" data-id="${esc(id)}" data-more="${more}">${isOpen ? '收起' : '+' + more}</span>`;
}

function now() {
  return new Date().toLocaleTimeString('en-GB');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])
  );
}

refreshBtn.addEventListener('click', load);
autoChk.addEventListener('change', () => {
  if (autoChk.checked) {
    timer = setInterval(load, 5000);
  } else {
    clearInterval(timer);
    timer = null;
  }
});

// 主题切换（亮/暗），记忆于 localStorage
const themeToggle = document.getElementById('themeToggle');
const themeGlyph = themeToggle.querySelector('.theme-glyph');
function syncThemeGlyph() {
  // 显示点击后切换到的主题：暗色时显示☀（切到亮），亮色时显示☾（切到暗）
  themeGlyph.textContent =
    document.documentElement.getAttribute('data-theme') === 'dark' ? '☀' : '☾';
}
themeToggle.addEventListener('click', () => {
  const next =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('npv-theme', next);
  syncThemeGlyph();
});
syncThemeGlyph();

// 端口折叠/展开（事件委托，跨重渲染有效）
function toggleMore(more) {
  const id = more.dataset.id;
  const cell = more.closest('.col-ports');
  if (expanded.has(id)) {
    expanded.delete(id);
    cell.classList.add('collapsed');
    more.textContent = '+' + more.dataset.more;
  } else {
    expanded.add(id);
    cell.classList.remove('collapsed');
    more.textContent = '收起';
  }
}
tbody.addEventListener('click', (e) => {
  const more = e.target.closest('.port-more');
  if (more) toggleMore(more);
});
tbody.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const more = e.target.closest('.port-more');
  if (!more) return;
  e.preventDefault();
  toggleMore(more);
});

load();
