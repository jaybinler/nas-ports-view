# nas-ports-view

NAS 上的 Docker 容器端口查看器。以容器方式运行，通过 Web 界面查看本机所有 Docker 容器的 **服务名 / IP 地址 / 运行状态 / 端口**。

- **host 网络模式**容器：显示该容器**当前实际监听（占用）的端口**（通过 procfs 归属）。
- 其他模式（bridge / 自定义网络等）：显示**映射到宿主机的端口**（如 `0.0.0.0:8080->80/tcp`）。
- IP 地址：host 模式显示**宿主机 LAN IP**，其他模式显示**容器内部 IP**。

## 快速开始

```bash
docker compose up -d
# 浏览器访问 http://<NAS_IP>:8088
```

或使用 `docker run`：

```bash
docker run -d --name nas-ports-view \
  --network host --pid host \
  --cap-add SYS_PTRACE --cap-add DAC_READ_SEARCH \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -p 8088:8088 \
  nas-ports-view:latest
```

> 注：`--network host` 下 `-p` 端口映射不生效，Web 直接监听宿主机的 `PORT`（默认 8088）。

## 运行所需权限（重要）

本应用需要读取宿主机进程信息以把 host 模式容器的监听端口归属到对应容器，因此需要以下权限：

| 参数 | 作用 |
|------|------|
| `--pid host` | 共享宿主机 PID 命名空间，扫描 `/proc/<pid>/fd` 将监听 socket 归属到容器进程树 |
| `--network host` | 读取宿主机 LAN IP 与宿主机监听端口表；Web 直接监听宿主端口 |
| `--cap-add SYS_PTRACE` | 读取其他进程 `/proc/<pid>/fd` 的 readlink 权限 |
| `--cap-add DAC_READ_SEARCH` | 辅助绕过部分文件权限检查 |
| 挂载 `docker.sock`（只读） | 列出容器、inspect 元数据（名称/状态/IP/网络模式/端口映射） |

**若 `SYS_PTRACE` 在你的 NAS 内核上不足**（例如启用了 `hidepid`），可改用 `privileged: true` 兜底：

```yaml
services:
  nas-ports-view:
    build: .
    network_mode: host
    pid: host
    privileged: true
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: unless-stopped
```

> 应用为**只读查看器**，不对 Docker 做任何写操作。默认仅限局域网访问；如需暴露公网，请配置 `BASIC_AUTH` 并置于反代之后。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8088` | Web 监听端口 |
| `HOST_IP` | 自动探测 | 手动覆盖宿主机 LAN IP（多网卡/探测不准时使用） |
| `BASIC_AUTH` | 无 | `user:pass` 开启 Basic 认证 |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket 路径 |

## 多架构构建

支持 `linux/amd64` + `linux/arm64`，覆盖 x86 与 ARM NAS：

```bash
docker buildx create --use --name npv-builder || docker buildx use npv-builder
docker buildx build --platform linux/amd64,linux/arm64 -t nas-ports-view:latest --push .
```

### 通过 GitHub Actions 自动构建

仓库含 `.github/workflows/docker-publish.yml`：push 到 `main` 或打 `v*` 标签时自动构建 amd64+arm64 并推送到 Docker Hub。需在仓库 **Settings → Secrets and variables → Actions** 添加：

- `DOCKERHUB_USERNAME`：Docker Hub 用户名（`jaybinler`）
- `DOCKERHUB_TOKEN`：Docker Hub 访问令牌（hub.docker.com → Account Settings → Security → New Access Token，**勿用密码**）

## 端口显示规则

| 容器网络模式 | 端口显示 | IP 显示 |
|------|------|------|
| `host` | procfs 归属的监听端口，如 `53/tcp host` | 宿主机 LAN IP |
| `bridge` / 自定义网络 | 宿主映射端口，如 `8080->80/tcp` | 容器内部 IP |
| bridge 未发布端口 | `8080/tcp 内部` | 容器内部 IP |
| `none` | - | - |
| `container:<id>` | 复用目标容器的端口/IP | 同目标容器 |
| 已停止 | - | - |

## 工作原理

1. 通过 dockerode（docker.sock）列出并 inspect 所有容器，获取名称、状态、网络模式、IP、端口映射、init PID。
2. 宿主机 LAN IP：读 `/proc/net/route` 找默认路由接口，取其 IPv4。
3. **host 模式端口归属**：
   - 解析 `/proc/net/{tcp,tcp6,udp,udp6}`，筛选 LISTEN（TCP `state=0A`、UDP 未连接）。
   - 全量扫描 `/proc/<pid>/fd/*`，建立 `socket inode -> PID` 映射。
   - 从容器 init PID 递归读 `/proc/<pid>/task/<tid>/children` 得到进程树。
   - 监听 socket 的 owning PID 落在某容器进程树内，则该端口归属此容器。

## 故障排查

- **host 模式容器端口为空**：确认容器以 `--pid host` 运行且具备 `SYS_PTRACE`（或 `privileged`）；个别 NAS 需 `privileged`。
- **宿主机 IP 探测不准**：用 `HOST_IP` 环境变量手动指定。
- **无法连接 docker.sock**：确认挂载了 `/var/run/docker.sock` 且路径正确（部分 NAS 路径不同，用 `DOCKER_SOCKET` 指定）。
- **Web 打不开**：`--network host` 模式下端口直接监听宿主机，确认 `PORT` 未被占用。

## 开发

```bash
npm install
npm test          # 单元测试（纯函数 + 临时 /proc 解析）
npm start         # 本地运行（需 Docker）
```

## License

MIT
