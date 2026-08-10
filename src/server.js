// Express 入口：静态托管前端 + 提供 /api/containers。
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listContainers, parseContainer, STATUS_TEXT } from './docker.js';
import { getHostIp } from './hostInfo.js';
import { buildHostContext, resolveHostPorts, mappedPorts } from './ports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8088;

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

// 可选 Basic 认证（BASIC_AUTH=user:pass）
if (process.env.BASIC_AUTH) {
  const idx = process.env.BASIC_AUTH.indexOf(':');
  const user = idx >= 0 ? process.env.BASIC_AUTH.slice(0, idx) : '';
  const pass = idx >= 0 ? process.env.BASIC_AUTH.slice(idx + 1) : '';
  app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    const m = /^Basic\s+(.+)$/i.exec(auth);
    if (m) {
      const decoded = Buffer.from(m[1], 'base64').toString();
      const sep = decoded.indexOf(':');
      const u = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const p = sep >= 0 ? decoded.slice(sep + 1) : '';
      if (u === user && p === pass) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="nas-ports-view"');
    res.status(401).send('Unauthorized');
  });
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/containers', async (_req, res) => {
  try {
    const hostIp = await getHostIp();
    const inspected = await listContainers();
    const parsed = inspected.map(parseContainer);
    const byId = new Map(parsed.map((p) => [p.id, p]));
    const byName = new Map(parsed.map((p) => [p.containerName, p]));

    // 仅当存在 host 模式容器时才扫描 /proc
    const hasHost = parsed.some((c) => c.networkMode === 'host');
    const ctx = hasHost ? await buildHostContext() : null;

    async function resolveBase(c) {
      const active = c.status === 'running' || c.status === 'paused';
      if (!active) return { ip: null, ports: [] };
      if (c.networkMode === 'host') {
        return { ip: hostIp, ports: await resolveHostPorts(c.pid, ctx) };
      }
      return { ip: c.containerIp, ports: mappedPorts(c.portsMap) };
    }

    const resolved = new Map();
    // 第一遍：非 container: 模式
    for (const c of parsed) {
      if (!c.networkMode.startsWith('container:')) {
        resolved.set(c.id, await resolveBase(c));
      }
    }
    // 第二遍：container: 模式复用目标容器的 IP/端口
    for (const c of parsed) {
      if (c.networkMode.startsWith('container:')) {
        const ref = c.networkMode.slice('container:'.length);
        const target =
          byId.get(ref) ||
          byName.get(ref) ||
          parsed.find((p) => p.id.startsWith(ref));
        resolved.set(
          c.id,
          target && resolved.has(target.id)
            ? resolved.get(target.id)
            : { ip: null, ports: [] }
        );
      }
    }

    const containers = parsed.map((c) => {
      const r = resolved.get(c.id) || { ip: null, ports: [] };
      return {
        id: c.id,
        service: c.service,
        containerName: c.containerName,
        status: c.status,
        statusText: STATUS_TEXT[c.status] || c.status,
        health: c.health,
        networkMode: c.networkMode,
        ip: r.ip,
        ports: r.ports,
      };
    });
    res.json({ hostIp, containers });
  } catch (e) {
    console.error('[/api/containers]', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`nas-ports-view listening on http://0.0.0.0:${PORT}`);
});
