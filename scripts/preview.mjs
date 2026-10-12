// 本地只读预览：展示本地前端并读取指定 NAS 接口，不操作 Docker。
import express from 'express';
import { fileURLToPath } from 'node:url';

const app = express();
const attempts = new Map();
const source = process.env.NAS_URL || 'http://192.168.31.6:9088';
const sample = { id: 'edge', service: '这是用于验证换行的超长应用名称_without_spaces_abcdefghijklmnopqrstuvwxyz', containerName: 'fixture-container', status: 'running', statusText: '运行中', health: 'unhealthy', networkMode: 'very_long_custom_network_name_abcdefghijklmnopqrstuvwxyz', ip: '2001:db8:1234:5678:abcd:ef01:2345:6789', ports: Array.from({ length: 20 }, (_, i) => ({ kind: i === 0 ? 'internal' : 'mapped', proto: i % 2 ? 'udp' : 'tcp', hostPort: 50000 + i, containerPort: 60000 + i, hostIp: '0.0.0.0' })) };
app.get('/api/containers', async (req, res) => {
  try {
    const fixture = new URL(req.headers.referer || 'http://localhost').searchParams.get('fixture');
    if (fixture === 'empty') return res.json({ hostIp: '192.168.31.6', containers: [] });
    if (fixture === 'error') return res.status(503).json({ error: 'preview fixture' });
    if (fixture === 'flaky') {
      const attempt = (attempts.get(req.headers.referer) || 0) + 1;
      attempts.set(req.headers.referer, attempt);
      if (attempt === 2) return res.status(503).json({ error: 'preview fixture' });
      return res.json({ hostIp: '192.168.31.6', containers: [sample] });
    }
    if (fixture === 'edge') return res.json({ hostIp: '192.168.31.6', containers: [sample, { id: 'stopped', service: '已停止应用', containerName: 'stopped', status: 'exited', statusText: '已停止', networkMode: 'none', ip: null, ports: [] }] });
    const response = await fetch(new URL('/api/containers', source), { signal: AbortSignal.timeout(15000) });
    res.status(response.status).json(await response.json());
  } catch (error) { res.status(502).json({ error: error.message }); }
});
app.use(express.static(fileURLToPath(new URL('../src/public', import.meta.url))));
app.listen(Number(process.env.PREVIEW_PORT) || 19088, '127.0.0.1', error => {
  if (error) { console.error('预览启动失败:', error.message); process.exitCode = 1; return; }
  console.log('本地预览 http://127.0.0.1:' + (process.env.PREVIEW_PORT || 19088));
});
