const tbody = document.querySelector('#tbl tbody');
const refreshBtn = document.getElementById('refresh');
const autoChk = document.getElementById('auto');
const hostIpEl = document.getElementById('hostIp');
const emptyEl = document.getElementById('empty');
const updatedEl = document.getElementById('updated');
let timer = null;

async function load() {
  try {
    const r = await fetch('/api/containers');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    render(data);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="error">加载失败：${esc(e.message)}</td></tr>`;
    updatedEl.textContent = '';
  }
}

function render(data) {
  hostIpEl.textContent = data.hostIp ? `宿主机 ${data.hostIp}` : '';
  const cs = data.containers || [];
  tbody.innerHTML = '';
  if (cs.length === 0) {
    emptyEl.hidden = false;
    updatedEl.textContent = '';
    return;
  }
  emptyEl.hidden = true;
  for (const c of cs) {
    const tr = document.createElement('tr');
    const nameCell =
      c.service !== c.containerName
        ? `${esc(c.service)}<div class="sub">${esc(c.containerName)}</div>`
        : esc(c.service);
    tr.innerHTML = `
      <td>${nameCell}</td>
      <td class="ip">${c.ip ? esc(c.ip) : '<span class="muted">-</span>'}</td>
      <td>${statusBadge(c)}</td>
      <td class="ports">${portBadges(c.ports, c.networkMode)}</td>
    `;
    tbody.appendChild(tr);
  }
  updatedEl.textContent = '更新于 ' + new Date().toLocaleTimeString();
}

function statusBadge(c) {
  const cls = c.status === 'running' ? 'ok' : c.status === 'paused' ? 'warn' : 'stop';
  let txt = c.statusText;
  if (c.health) txt += ` · ${c.health}`;
  return `<span class="badge ${cls}">${esc(txt)}</span>`;
}

function portBadges(ports, networkMode) {
  if (!ports || ports.length === 0) {
    const hint = networkMode && networkMode.startsWith('container:')
      ? ` <span class="muted">共享 ${esc(networkMode.slice('container:'.length))} 网络</span>`
      : '';
    return `<span class="muted">-</span>${hint}`;
  }
  return ports
    .map((p) => {
      if (p.kind === 'host-listen') {
        return `<span class="port host" title="host 模式监听 ${esc(p.listenAddr)}:${p.port}">${p.port}/${p.proto} <em>host</em></span>`;
      }
      if (p.kind === 'mapped') {
        return `<span class="port" title="${esc(p.hostIp)}:${p.hostPort} -> ${p.containerPort}/${p.proto}">${p.hostPort}→${p.containerPort}/${p.proto}</span>`;
      }
      return `<span class="port internal" title="未发布，仅容器内部">${p.containerPort}/${p.proto} <em>内部</em></span>`;
    })
    .join('');
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

load();
