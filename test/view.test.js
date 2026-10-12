import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowHTML, portInfo } from '../src/public/view.js';

const container = { id: 'test-id', service: 'pansou', containerName: 'pansou-backend', status: 'running', statusText: '运行中', health: 'healthy', networkMode: 'pansou_default', ip: '172.19.0.2', ports: [] };

test('首次加载和刷新均生成完整行标签及五个对应单元格', () => {
  for (const firstRender of [true, false]) {
    const html = rowHTML(container, 0, { firstRender });
    assert.match(html, /^<tr class="[^"]*" data-id="test-id" role="row"(?: style="animation-delay:0ms")?>\s*<td class="col-svc"/);
    assert.equal((html.match(/<td\b/g) || []).length, 5);
    for (const heading of ['svc', 'ip', 'st', 'net', 'ports']) assert.ok(html.includes(`headers="heading-${heading}"`));
    assert.match(html, /<summary[^>]*><span class="svc-title">pansou<\/span><\/summary>/);
    assert.ok(html.indexOf('pansou-backend') > html.indexOf('<div class="service-info">'));
  }
});

test('外部名称、网络、地址、协议和端口值不能注入标签或属性', () => {
  const attack = '"><script>alert(1)</script>';
  const html = rowHTML({ ...container, id: attack, service: attack, networkMode: attack, ports: [{ kind: 'mapped', proto: attack, hostPort: attack, containerPort: attack, hostIp: attack }] }, 0);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('proto="'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('缺少名称、IP 和端口时仍有明确展示；共享网络保留完整引用', () => {
  const html = rowHTML({ id: 'none', networkMode: 'container:target-123', ports: null }, 0);
  assert.ok(html.includes('未命名应用'));
  assert.ok(html.includes('共享网络，暂无端口数据'));
  assert.ok(html.includes('container:target-123'));
  assert.match(html, /class="ip-val">—/);
});

test('大量端口默认只显示五个，展开状态与详情状态可跨刷新恢复', () => {
  const ports = Array.from({ length: 20 }, (_, i) => ({ kind: 'host-listen', port: 8000 + i, proto: 'tcp' }));
  const closed = rowHTML({ ...container, ports }, 0);
  assert.equal((closed.match(/ hidden title=/g) || []).length, 15);
  assert.ok(closed.includes('aria-expanded="false"'));
  const open = rowHTML({ ...container, ports }, 0, { expanded: true, detailsOpen: true });
  assert.ok(!open.includes(' hidden title='));
  assert.ok(open.includes('aria-expanded="true"'));
  assert.ok(open.includes('class="service-details" open'));
});

test('端口明确区分宿主映射、宿主监听、未发布内部端口', () => {
  assert.equal(portInfo({ kind: 'mapped', hostPort: 18888, containerPort: 8888, proto: 'tcp' }).label, '18888 → 8888/tcp');
  assert.equal(portInfo({ kind: 'host-listen', port: 5353, proto: 'udp' }).label, '5353/udp');
  assert.match(portInfo({ kind: 'internal', containerPort: 80 }).detail, /未发布到 NAS/);
});
