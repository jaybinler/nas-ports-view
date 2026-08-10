import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mappedPorts } from '../src/ports.js';

test('mappedPorts 解析已发布端口（按容器端口排序）', () => {
  const ports = mappedPorts({
    '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
    '53/udp': [{ HostIp: '0.0.0.0', HostPort: '1053' }],
  });
  assert.equal(ports.length, 2);
  // 按 containerPort 升序：53 在前，80 在后
  assert.deepEqual(ports[0], {
    proto: 'udp',
    containerPort: 53,
    hostIp: '0.0.0.0',
    hostPort: 1053,
    kind: 'mapped',
  });
  assert.deepEqual(ports[1], {
    proto: 'tcp',
    containerPort: 80,
    hostIp: '0.0.0.0',
    hostPort: 8080,
    kind: 'mapped',
  });
});

test('mappedPorts 处理未发布端口（null bindings）', () => {
  const ports = mappedPorts({ '8080/tcp': null });
  assert.equal(ports.length, 1);
  assert.equal(ports[0].kind, 'internal');
  assert.equal(ports[0].hostPort, null);
});

test('mappedPorts 空/null 输入', () => {
  assert.deepEqual(mappedPorts(null), []);
  assert.deepEqual(mappedPorts({}), []);
});

test('mappedPorts 同端口多绑定', () => {
  const ports = mappedPorts({
    '80/tcp': [
      { HostIp: '0.0.0.0', HostPort: '8080' },
      { HostIp: '127.0.0.1', HostPort: '8081' },
    ],
  });
  assert.equal(ports.length, 2);
  assert.equal(ports[0].hostPort, 8080);
  assert.equal(ports[1].hostPort, 8081);
});

test('mappedPorts 缺省 HostIp 回退 0.0.0.0', () => {
  const ports = mappedPorts({ '80/tcp': [{ HostPort: '8080' }] });
  assert.equal(ports[0].hostIp, '0.0.0.0');
});
