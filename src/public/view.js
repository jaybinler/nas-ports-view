// 纯展示函数：电脑表格和手机卡片共享同一份语义化 DOM。
export const PREVIEW = 5;

/** 转义文本与双引号属性中的外部数据；不修改输入。 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

/** 格式化单个端口及地址信息，未知协议只作为文本展示。 */
export function portInfo(port) {
  const proto = String(port.proto || 'tcp');
  const protocolClass = proto === 'udp' ? 'udp' : 'tcp';
  if (port.kind === 'host-listen') {
    return { label: `${port.port}/${proto}`, detail: `宿主监听 ${port.listenAddr || '*'} · ${port.port}/${proto}`, kind: 'host', protocolClass };
  }
  if (port.kind === 'mapped') {
    return { label: `${port.hostPort} → ${port.containerPort}/${proto}`, detail: `宿主 ${port.hostIp || '*'} · ${port.hostPort} → 容器 ${port.containerPort}/${proto}`, kind: 'mapped', protocolClass };
  }
  return { label: `${port.containerPort}/${proto} 内部`, detail: `容器内部 ${port.containerPort}/${proto}，未发布到 NAS`, kind: 'internal', protocolClass };
}

/** 生成合法五列表格行；展开状态由调用方传入，无持久化副作用。 */
export function rowHTML(c, index, { firstRender = false, expanded = false, detailsOpen = false } = {}) {
  const name = c.service || c.containerName || '未命名应用';
  const ports = Array.isArray(c.ports) ? c.ports : [];
  const mode = String(c.networkMode || '未知');
  const networkLabel = mode.startsWith('container:') ? 'container（共享）' : mode;
  const statusClass = c.status === 'running' ? 'led-green' : ['paused', 'restarting', 'created'].includes(c.status) ? 'led-amber' : 'led-red';
  const healthText = { healthy: '健康', unhealthy: '不健康', starting: '检查中' }[c.health] || c.health;
  const health = healthText ? `<span class="health${c.health === 'unhealthy' ? ' health-error' : ''}">健康检查：${esc(healthText)}</span>` : '';
  const chips = ports.map((p, i) => {
    const info = portInfo(p);
    return `<span class="port ${info.protocolClass} ${info.kind}"${i >= PREVIEW && !expanded ? ' hidden' : ''} title="${esc(info.detail)}">${esc(info.label)}</span>`;
  }).join('');
  const more = ports.length > PREVIEW
    ? `<button class="port-more" type="button" data-id="${esc(c.id)}" data-focus="ports" aria-expanded="${expanded}" aria-label="${esc(name)}：${expanded ? '收起端口' : '展开剩余 ' + (ports.length - PREVIEW) + ' 个端口'}">${expanded ? '收起' : '+' + (ports.length - PREVIEW) + ' 个'}</button>` : '';
  const noPorts = mode.startsWith('container:') ? '共享网络，暂无端口数据' : '暂无端口';
  const animation = firstRender ? ` style="animation-delay:${Math.min(index * 35, 350)}ms"` : '';
  return `<tr class="row${firstRender ? ' row-in' : ''}" data-id="${esc(c.id)}" role="row"${animation}>
    <td class="col-svc" headers="heading-svc" role="cell">
      <details class="service-details"${detailsOpen ? ' open' : ''}>
        <summary class="svc-name" data-focus="details" title="${esc(name)}"><span class="svc-title">${esc(name)}</span></summary>
        <div class="service-info">
          <dl><dt>应用</dt><dd>${esc(name)}</dd><dt>容器</dt><dd>${esc(c.containerName || '—')}</dd><dt>网络</dt><dd>${esc(mode)}</dd></dl>
          <span class="detail-label">完整端口信息</span>
          <ul>${ports.length ? ports.map(p => `<li>${esc(portInfo(p).detail)}</li>`).join('') : `<li>${esc(noPorts)}</li>`}</ul>
        </div>
      </details>
    </td>
    <td class="col-ip" headers="heading-ip" role="cell"><span class="field-label" aria-hidden="true">IP 地址</span><span class="ip-val">${esc(c.ip || '—')}</span></td>
    <td class="col-st" headers="heading-st" role="cell"><span class="status"><span class="led ${statusClass}" aria-hidden="true"></span>${esc(c.statusText || c.status || '未知')}</span>${health}</td>
    <td class="col-net" headers="heading-net" role="cell"><span class="field-label" aria-hidden="true">网络模式</span><span class="net${mode === 'host' ? ' net-host' : ''}">${esc(networkLabel)}</span></td>
    <td class="col-ports" headers="heading-ports" role="cell"><span class="field-label" aria-hidden="true">端口</span><div class="ports-list">${chips || `<span class="dim">${esc(noPorts)}</span>`}${more}</div></td>
  </tr>`;
}
