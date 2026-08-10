// procfs 解析：读取 /proc/net/{tcp,tcp6,udp,udp6} 的监听 socket，
// 建立 socket inode -> PID 映射，以及容器进程树。
// 通过 PROC_ROOT 环境变量可重定向 /proc（便于测试）。
import fs from 'node:fs/promises';
import path from 'node:path';

function procRoot() {
  return process.env.PROC_ROOT || '/proc';
}

// ---------------- 纯函数（便于单元测试） ----------------

// 8 位十六进制（小端）-> IPv4 点分字符串
export function hexToIPv4(hex) {
  const b = Buffer.from(hex, 'hex');
  return `${b[3]}.${b[2]}.${b[1]}.${b[0]}`;
}

function padHex(n) {
  return n.toString(16).padStart(2, '0');
}

// 32 位十六进制（4 个小端 32 位字）-> IPv6 字符串
export function hexToIPv6(hex) {
  const bytes = Buffer.from(hex, 'hex'); // 16 字节
  const hextets = [];
  for (let i = 0; i < 4; i++) {
    const w = bytes.subarray(i * 4, i * 4 + 4); // [b0,b1,b2,b3]，小端
    // 高 16 位 = b2 | b3<<8；低 16 位 = b0 | b1<<8
    hextets.push(`${padHex(w[3])}${padHex(w[2])}`);
    hextets.push(`${padHex(w[1])}${padHex(w[0])}`);
  }
  return compressIPv6(hextets);
}

// 压缩 IPv6：最长 0 串 -> ::
function compressIPv6(hextets) {
  const norm = hextets.map((h) => {
    const v = h.replace(/^0+/, '');
    return v === '' ? '0' : v;
  });
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return norm.join(':');
  const before = norm.slice(0, bestStart);
  const after = norm.slice(bestStart + bestLen);
  return before.join(':') + '::' + after.join(':');
}

// 解析 /proc/net/{tcp,tcp6,udp,udp6} 的一行数据
export function parseTcpLine(line, proto, family) {
  const f = line.trim().split(/\s+/);
  if (f.length < 10) return null;
  if (!/^\d+:$/.test(f[0])) return null; // 非数据行（表头等）
  const local = f[1];
  const rem = f[2];
  const state = f[3];
  const inode = f[9];
  const colon = local.lastIndexOf(':');
  if (colon === -1) return null;
  const addrHex = local.slice(0, colon);
  const portHex = local.slice(colon + 1);
  const port = parseInt(portHex, 16);
  let isListen;
  if (proto === 'udp') {
    // 未连接的监听 UDP：rem_address 全 0
    const remColon = rem.lastIndexOf(':');
    const remAddr = remColon === -1 ? rem : rem.slice(0, remColon);
    isListen = /^0+$/.test(remAddr);
  } else {
    isListen = state === '0A'; // LISTEN
  }
  const addr = family === 'ipv4' ? hexToIPv4(addrHex) : hexToIPv6(addrHex);
  return { proto, family, addr, port, inode, isListen };
}

// readlink 结果 -> socket inode，非 socket 返回 null
export function parseSocketInode(target) {
  const m = /^socket:\[(\d+)\]$/.exec(target);
  return m ? m[1] : null;
}

// 纯归属逻辑：给定监听 socket 列表、inode->PID 映射、进程树(Set)，
// 返回属于该进程树的监听端口。
export function attributePorts(sockets, inodeToPids, pidTree) {
  const seen = new Set();
  const ports = [];
  for (const s of sockets) {
    if (!s.isListen) continue;
    const pids = inodeToPids.get(s.inode);
    if (!pids) continue;
    if (!pids.some((p) => pidTree.has(p))) continue;
    const key = `${s.proto}:${s.port}:${s.addr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ports.push({
      proto: s.proto,
      port: s.port,
      listenAddr: s.addr,
      family: s.family,
      kind: 'host-listen',
    });
  }
  ports.sort(
    (a, b) => a.port - b.port || (a.proto < b.proto ? -1 : a.proto > b.proto ? 1 : 0)
  );
  return ports;
}

// ---------------- I/O 函数 ----------------

const NET_FILES = [
  { rel: 'net/tcp', proto: 'tcp', family: 'ipv4' },
  { rel: 'net/tcp6', proto: 'tcp', family: 'ipv6' },
  { rel: 'net/udp', proto: 'udp', family: 'ipv4' },
  { rel: 'net/udp6', proto: 'udp', family: 'ipv6' },
];

// 读取所有监听 socket（TCP LISTEN + 未连接 UDP）
export async function readListeningSockets() {
  const root = procRoot();
  const result = [];
  for (const { rel, proto, family } of NET_FILES) {
    let content;
    try {
      content = await fs.readFile(path.join(root, rel), 'utf8');
    } catch {
      continue; // 文件不存在则跳过
    }
    const lines = content.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const parsed = parseTcpLine(lines[i], proto, family);
      if (parsed && parsed.isListen) result.push(parsed);
    }
  }
  return result;
}

// 全量扫描 /proc/<pid>/fd，建立 socket inode -> PID[] 映射
export async function buildInodeToPids() {
  const root = procRoot();
  const map = new Map();
  let entries;
  try {
    entries = await fs.readdir(root);
  } catch {
    return map;
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const fdDir = path.join(root, name, 'fd');
    let fds;
    try {
      fds = await fs.readdir(fdDir);
    } catch {
      continue; // 权限不足等，跳过
    }
    for (const fd of fds) {
      let target;
      try {
        target = await fs.readlink(path.join(fdDir, fd));
      } catch {
        continue;
      }
      const inode = parseSocketInode(target);
      if (inode !== null) {
        if (!map.has(inode)) map.set(inode, []);
        map.get(inode).push(Number(name));
      }
    }
  }
  return map;
}

// 从 rootPid 递归收集进程树所有 PID（通过 /proc/<pid>/task/<tid>/children）
export async function getProcessTree(rootPid) {
  const root = procRoot();
  const result = new Set();
  if (!rootPid) return result;
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (result.has(pid)) continue;
    result.add(pid);
    let tids;
    try {
      tids = await fs.readdir(path.join(root, String(pid), 'task'));
    } catch {
      continue;
    }
    for (const tid of tids) {
      try {
        const data = await fs.readFile(
          path.join(root, String(pid), 'task', tid, 'children'),
          'utf8'
        );
        const children = data.trim().split(/\s+/).filter(Boolean);
        for (const c of children) {
          const n = Number(c);
          if (!result.has(n)) stack.push(n);
        }
      } catch {
        /* 忽略单个 tid 读取失败 */
      }
    }
  }
  return result;
}
