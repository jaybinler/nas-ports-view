// 端口归属核心逻辑：host 模式走 procfs 归属，其他模式走端口映射解析。
import {
  readListeningSockets,
  buildInodeToPids,
  getProcessTree,
  attributePorts,
} from './procfs.js';

// 一次性构建 host 模式所需上下文（监听 socket 表 + inode->PID 映射），
// 供所有 host 模式容器复用，避免重复扫描 /proc。
export async function buildHostContext() {
  const [sockets, inodeToPids] = await Promise.all([
    readListeningSockets(),
    buildInodeToPids(),
  ]);
  return { sockets, inodeToPids };
}

// host 模式容器：归属监听端口到其进程树
export async function resolveHostPorts(rootPid, ctx) {
  if (!rootPid || !ctx) return [];
  const tree = await getProcessTree(rootPid);
  return attributePorts(ctx.sockets, ctx.inodeToPids, tree);
}

// 非 host 模式：解析 NetworkSettings.Ports
// 例：{ "80/tcp":[{"HostIp":"0.0.0.0","HostPort":"8080"}], "53/udp": null }
export function mappedPorts(portsMap) {
  const result = [];
  const seen = new Set();
  if (!portsMap) return result;
  for (const [key, bindings] of Object.entries(portsMap)) {
    const idx = key.lastIndexOf('/');
    if (idx === -1) continue;
    const containerPort = Number(key.slice(0, idx));
    const proto = key.slice(idx + 1);
    if (!bindings || bindings.length === 0) {
      // 未发布，仅容器内部
      const dk = `${proto}:${containerPort}:internal`;
      if (seen.has(dk)) continue;
      seen.add(dk);
      result.push({ proto, containerPort, hostIp: null, hostPort: null, kind: 'internal' });
    } else {
      for (const b of bindings) {
        const hostPort = b.HostPort ? Number(b.HostPort) : null;
        // 合并 0.0.0.0 与 :: 同宿主端口的双栈绑定，避免重复
        const dk = `${proto}:${containerPort}:${hostPort}`;
        if (seen.has(dk)) continue;
        seen.add(dk);
        result.push({
          proto,
          containerPort,
          hostIp: b.HostIp || '0.0.0.0',
          hostPort,
          kind: 'mapped',
        });
      }
    }
  }
  result.sort(
    (a, b) =>
      a.containerPort - b.containerPort ||
      (a.proto < b.proto ? -1 : a.proto > b.proto ? 1 : 0)
  );
  return result;
}
