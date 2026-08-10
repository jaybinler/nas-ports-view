// 宿主机 LAN IP 检测：优先默认路由接口的 IPv4。
// 容器以 --network=host 运行时，os.networkInterfaces() 即宿主机网卡。
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function getHostIp() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  const root = process.env.PROC_ROOT || '/proc';

  // 读 /proc/net/route 找默认路由（Destination == 00000000）的接口名
  let iface = null;
  try {
    const data = await fs.readFile(path.join(root, 'net', 'route'), 'utf8');
    const lines = data.split('\n').slice(1);
    for (const line of lines) {
      const f = line.trim().split(/\s+/);
      if (f.length >= 8 && f[1] === '00000000') {
        iface = f[0];
        break;
      }
    }
  } catch {
    /* 忽略 */
  }

  const interfaces = os.networkInterfaces();
  const pick = (name) => {
    const list = interfaces[name];
    if (!list) return null;
    for (const a of list) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
    return null;
  };

  if (iface && pick(iface)) return pick(iface);

  // 兜底：第一个非回环、非 docker/虚拟网卡的 IPv4
  for (const [name, list] of Object.entries(interfaces)) {
    if (/^(docker|br-|veth|virbr|tun|tap)/.test(name)) continue;
    if (!list) continue;
    for (const a of list) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}
