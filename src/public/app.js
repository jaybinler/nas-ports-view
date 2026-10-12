import { PREVIEW, rowHTML } from './view.js';

const tbody = document.getElementById('tbody');
const refreshBtn = document.getElementById('refresh');
const autoChk = document.getElementById('auto');
const notice = document.getElementById('notice');
const expanded = new Set();
let firstRender = true;
let hasData = false;
let loading = false;
let timer = null;

// 只允许一个请求在途；失败保留上次成功数据，超时后可重试。
async function load() {
  if (loading) return;
  loading = true;
  refreshBtn.disabled = true;
  refreshBtn.setAttribute('aria-busy', 'true');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/containers', { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!data || !Array.isArray(data.containers) || data.containers.some(c =>
      !c || typeof c !== 'object' || typeof c.id !== 'string' ||
      (c.ports != null && (!Array.isArray(c.ports) || c.ports.some(p => !p || typeof p !== 'object'))))) {
      throw new Error('接口数据格式异常');
    }
    render(data);
    hasData = true;
    notice.hidden = true;
    setSignal(true);
  } catch (error) {
    setSignal(false);
    notice.hidden = false;
    notice.textContent = `${hasData ? '更新失败，保留上次成功数据。' : '读取失败。'}${error.name === 'AbortError' ? '请求超时' : error.message}；请点击重新扫描重试。`;
  } finally {
    clearTimeout(timeout);
    loading = false;
    refreshBtn.disabled = false;
    refreshBtn.removeAttribute('aria-busy');
  }
}

function setSignal(ok) {
  document.getElementById('signalLed').className = 'led ' + (ok ? 'led-green' : 'led-red');
  document.getElementById('signalText').textContent = ok ? '连接正常' : '更新失败';
}

function render(data) {
  const openDetails = new Set(Array.from(tbody.querySelectorAll('.service-details[open]'), el => el.closest('.row').dataset.id));
  const active = document.activeElement;
  const focusedId = tbody.contains(active) ? active.closest('.row')?.dataset.id : null;
  const focusedAction = active?.dataset.focus;
  const liveIds = new Set(data.containers.map(c => c.id));
  const html = data.containers.map((c, i) => rowHTML(c, i, {
    firstRender, expanded: expanded.has(c.id), detailsOpen: openDetails.has(c.id),
  })).join('');
  for (const id of expanded) if (!liveIds.has(id)) expanded.delete(id);
  document.getElementById('hostIp').textContent = data.hostIp || '—';
  document.getElementById('countReadout').textContent = '应用: ' + data.containers.length;
  tbody.innerHTML = html;
  document.getElementById('empty').hidden = data.containers.length !== 0;
  document.getElementById('updatedReadout').textContent = '上次更新: ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  firstRender = false;
  if (focusedId && focusedAction) {
    const row = Array.from(tbody.querySelectorAll('.row')).find(el => el.dataset.id === focusedId);
    row?.querySelector(`[data-focus="${focusedAction === 'ports' ? 'ports' : 'details'}"]`)?.focus({ preventScroll: true });
  }
}

refreshBtn.addEventListener('click', load);
autoChk.addEventListener('change', () => {
  clearInterval(timer);
  timer = autoChk.checked ? setInterval(load, 5000) : null;
});

const themeToggle = document.getElementById('themeToggle');
function syncThemeGlyph() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  themeToggle.querySelector('.theme-glyph').textContent = dark ? '☀' : '☾';
  themeToggle.setAttribute('aria-label', dark ? '切换亮色主题' : '切换暗色主题');
}
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('npv-theme', next); } catch { /* 存储不可用时仍可切换主题。 */ }
  syncThemeGlyph();
});
syncThemeGlyph();

tbody.addEventListener('click', event => {
  const button = event.target.closest('.port-more');
  if (!button) return;
  const id = button.dataset.id;
  const isOpen = !expanded.has(id);
  if (isOpen) expanded.add(id); else expanded.delete(id);
  const ports = button.closest('.ports-list').querySelectorAll('.port');
  ports.forEach((port, index) => { port.hidden = !isOpen && index >= PREVIEW; });
  button.setAttribute('aria-expanded', String(isOpen));
  button.textContent = isOpen ? '收起' : '+' + (ports.length - PREVIEW) + ' 个';
  button.setAttribute('aria-label', button.closest('.row').querySelector('.svc-name').textContent + '：' + (isOpen ? '收起端口' : '展开剩余 ' + (ports.length - PREVIEW) + ' 个端口'));
});

load();
