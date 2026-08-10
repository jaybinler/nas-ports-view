import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  hexToIPv4,
  hexToIPv6,
  parseTcpLine,
  parseSocketInode,
  attributePorts,
  readListeningSockets,
  getProcessTree,
} from '../src/procfs.js';

test('hexToIPv4 解析小端 IPv4', () => {
  assert.equal(hexToIPv4('0100007F'), '127.0.0.1');
  assert.equal(hexToIPv4('00000000'), '0.0.0.0');
  assert.equal(hexToIPv4('0100A8C0'), '192.168.0.1');
});

test('hexToIPv6 解析 :: 与 ::1', () => {
  assert.equal(hexToIPv6('00000000000000000000000000000000'), '::');
  assert.equal(hexToIPv6('00000000000000000000000001000000'), '::1');
});

test('parseTcpLine 解析 TCP LISTEN 行', () => {
  const line =
    '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0';
  const r = parseTcpLine(line, 'tcp', 'ipv4');
  assert.deepEqual(r, {
    proto: 'tcp',
    family: 'ipv4',
    addr: '127.0.0.1',
    port: 8080,
    inode: '12345',
    isListen: true,
  });
});

test('parseTcpLine 非监听 TCP（ESTABLISHED）', () => {
  const line =
    '   1: 0100007F:1F90 0100007F:2328 01 00000000:00000000 00:00000000 00000000     0        0 67890 1 0000000000000000 20 4 30 5 -1';
  const r = parseTcpLine(line, 'tcp', 'ipv4');
  assert.equal(r.isListen, false);
  assert.equal(r.inode, '67890');
});

test('parseTcpLine UDP 绑定（rem 全 0）', () => {
  const line =
    '   0: 00000000:0035 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 11111 1 0000000000000000 100 0 0 10 0';
  const r = parseTcpLine(line, 'udp', 'ipv4');
  assert.equal(r.isListen, true);
  assert.equal(r.port, 53);
  assert.equal(r.addr, '0.0.0.0');
});

test('parseTcpLine 忽略字段不足的行', () => {
  assert.equal(parseTcpLine('not a line', 'tcp', 'ipv4'), null);
  assert.equal(parseTcpLine('', 'tcp', 'ipv4'), null);
});

test('parseSocketInode 提取 socket inode', () => {
  assert.equal(parseSocketInode('socket:[12345]'), '12345');
  assert.equal(parseSocketInode('anon_inode:[eventpoll]'), null);
  assert.equal(parseSocketInode('/dev/null'), null);
});

test('attributePorts 将监听端口归属到进程树', () => {
  const sockets = [
    { proto: 'tcp', family: 'ipv4', addr: '0.0.0.0', port: 80, inode: '100', isListen: true },
    { proto: 'tcp', family: 'ipv4', addr: '0.0.0.0', port: 443, inode: '101', isListen: true },
    { proto: 'tcp', family: 'ipv4', addr: '0.0.0.0', port: 22, inode: '102', isListen: true },
    { proto: 'tcp', family: 'ipv4', addr: '0.0.0.0', port: 8080, inode: '103', isListen: false },
  ];
  const inodeToPids = new Map([
    ['100', [10]],
    ['101', [20]],
    ['102', [30]],
  ]);
  const tree = new Set([10, 11, 12]); // 容器拥有 pid 10 -> 端口 80
  const ports = attributePorts(sockets, inodeToPids, tree);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].port, 80);
  assert.equal(ports[0].kind, 'host-listen');
});

test('attributePorts 去重相同端口', () => {
  const sockets = [
    { proto: 'tcp', family: 'ipv4', addr: '0.0.0.0', port: 53, inode: '200', isListen: true },
    { proto: 'tcp', family: 'ipv4', addr: '0.0.0.0', port: 53, inode: '201', isListen: true },
  ];
  const inodeToPids = new Map([
    ['200', [10]],
    ['201', [10]],
  ]);
  const tree = new Set([10]);
  const ports = attributePorts(sockets, inodeToPids, tree);
  assert.equal(ports.length, 1);
});

test('readListeningSockets 通过临时 PROC_ROOT 读取', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'npv-'));
  await fs.mkdir(path.join(dir, 'net'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'net', 'tcp'),
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' +
      '   0: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 999 1 0000000000000000 100 0 0 10 0\n'
  );
  process.env.PROC_ROOT = dir;
  try {
    const sockets = await readListeningSockets();
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].port, 80);
    assert.equal(sockets[0].inode, '999');
  } finally {
    delete process.env.PROC_ROOT;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('getProcessTree 递归收集子进程', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'npv-'));
  const mk = async (pid, children) => {
    await fs.mkdir(path.join(dir, pid, 'task', pid), { recursive: true });
    await fs.writeFile(path.join(dir, pid, 'task', pid, 'children'), children);
  };
  await mk('100', '101 102\n');
  await mk('101', '103\n');
  await mk('102', '');
  await mk('103', '');
  process.env.PROC_ROOT = dir;
  try {
    const tree = await getProcessTree(100);
    assert.equal(tree.size, 4);
    assert.ok(tree.has(100));
    assert.ok(tree.has(101));
    assert.ok(tree.has(102));
    assert.ok(tree.has(103));
  } finally {
    delete process.env.PROC_ROOT;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
