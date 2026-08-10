// dockerode 封装：列出并 inspect 所有容器，解析所需元数据。
import Docker from 'dockerode';

let docker;
function getDocker() {
  if (!docker) {
    const opts = process.env.DOCKER_SOCKET
      ? { socketPath: process.env.DOCKER_SOCKET }
      : undefined;
    docker = new Docker(opts);
  }
  return docker;
}

export async function listContainers() {
  const d = getDocker();
  const summary = await d.listContainers({ all: true });
  const inspected = await Promise.all(
    summary.map((s) => d.getContainer(s.Id).inspect())
  );
  return inspected;
}

export function parseContainer(info) {
  const labels = info.Config?.Labels || {};
  const name = (info.Name || '').replace(/^\//, '');
  const service = labels['com.docker.compose.service'] || name;
  const status = info.State?.Status || 'unknown';
  const health = info.State?.Health?.Status || null;
  const networkMode = info.HostConfig?.NetworkMode || 'bridge';
  const pid = info.State?.Pid || 0;
  const portsMap = info.NetworkSettings?.Ports || null;

  // 容器内部 IP：取第一个非空网卡 IP
  let containerIp = null;
  const networks = info.NetworkSettings?.Networks || {};
  for (const net of Object.values(networks)) {
    if (net.IPAddress) {
      containerIp = net.IPAddress;
      break;
    }
  }
  return {
    id: info.Id,
    service,
    containerName: name,
    status,
    health,
    networkMode,
    pid,
    portsMap,
    containerIp,
  };
}

export const STATUS_TEXT = {
  running: '运行中',
  exited: '已停止',
  paused: '已暂停',
  restarting: '重启中',
  created: '已创建',
  dead: '已停止',
  removing: '移除中',
};
