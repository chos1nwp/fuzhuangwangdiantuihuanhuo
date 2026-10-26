# 容器化部署说明

> 项目：衣返 · 服装网店退换货处理系统（选题二）
> 适用：把项目打包成容器，在一台只装了 Docker 的机器上一条命令跑起来，也方便交付给老师或同学。

---

## 1. 打包成了什么

应用和数据库被拆成两个容器，用 `docker compose` 一起管理：

```
                    ┌─────────────────────────────────────┐
   浏览器            │  Docker 网络（容器间用服务名互相访问）  │
  http://localhost  │                                     │
      :3000  ──────▶│  app 容器（clothes-app）              │
                    │  node:22-alpine · 非 root 用户        │
                    │  端口 3000                            │
                    │        │ DB_HOST=mysql               │
                    │        ▼                              │
                    │  mysql 容器（clothes-mysql）          │
                    │  mysql:8.0 · utf8mb4 · +08:00         │
                    │        │                              │
                    └────────┼──────────────────────────────┘
                             ▼
                    命名卷 clothes-mysql-data
                    （删容器不丢数据）
```

| 组件 | 来源 | 说明 |
| --- | --- | --- |
| `app` | 本项目 `Dockerfile` 构建，镜像名 `clothes-after-sale:1.1.0` | 只装生产依赖，代码在镜像里，容器内不可改 |
| `mysql` | 官方镜像 `mysql:8.0` | 首次启动自动建库，应用启动时自动建表并写模拟数据 |
| 数据 | Docker 命名卷 `clothes-mysql-data` | 容器删了数据还在，只有 `down -v` 才清空 |

镜像里**不含** `.env`、`node_modules`、`docs/`，数据库密码通过环境变量传入，不会被打包进镜像。

---

## 2. 前置条件：装 Docker

项目里已经有 `Dockerfile`、`docker-compose.yml`、`.dockerignore`，**不需要改任何代码**，只差一个 Docker 运行环境。

### Windows

1. 打开 <https://www.docker.com/products/docker-desktop/> 下载 Docker Desktop 并安装
2. 安装时勾选 **Use WSL 2 instead of Hyper-V**（默认就是）
3. 安装完重启电脑，启动 Docker Desktop，等左下角鲸鱼图标变绿
4. 打开终端验证：

```bash
docker --version
docker compose version
```

看到类似输出就说明装好了：

```
Docker version 27.x.x, build ...
Docker Compose version v2.x.x
```

> 如果 `docker` 命令找不到，通常是 Docker Desktop 没启动，或者装完还没重启终端。

### macOS / Linux

- macOS：同样装 Docker Desktop
- Linux：`curl -fsSL https://get.docker.com | sh`，然后 `sudo usermod -aG docker $USER` 重新登录

> 老版本只有 `docker-compose`（带横线）命令的，把下面所有 `docker compose` 换成 `docker-compose` 即可。

---

## 3. 一键启动

在项目根目录（`docker-compose.yml` 所在目录）执行：

```bash
cd /d/AI-FullStack/Clothes

docker compose up -d --build
```

| 参数 | 含义 |
| --- | --- |
| `up` | 创建并启动容器 |
| `-d` | 后台运行（不占用当前终端） |
| `--build` | 先按 Dockerfile 构建应用镜像（第一次必须加，改代码后也要加） |

第一次执行会下载 `mysql:8.0`（约 600 MB）和 `node:22-alpine`，视网速需要几分钟。看到下面这样的输出就成功了：

```
✔ Network clothes-after-sale_default  Created
✔ Container clothes-mysql             Healthy
✔ Container clothes-app               Started
```

### 确认状态

```bash
docker compose ps
```

正常情况下两个容器都是 `running`，`STATUS` 一列里能看到 `(healthy)`：

```
NAME             IMAGE                        STATUS                    PORTS
clothes-app      clothes-after-sale:1.1.0     Up 30 seconds (healthy)   0.0.0.0:3000->3000/tcp
clothes-mysql    mysql:8.0                    Up 40 seconds (healthy)   127.0.0.1:3307->3306/tcp
```

> 刚启动的十几秒里 app 可能显示 `starting`，因为它在等 MySQL 初始化并建表，等一会儿会变成 `healthy`。

### 打开页面

浏览器访问 **<http://localhost:3000>**

### 演示账号（密码统一 `123456`）

| 手机号 | 姓名 | 岗位 |
| --- | --- | --- |
| `13800000001` | 林小雨 | 消费者 |
| `13900000001` | 苏晴 | 售后客服 |
| `13700000001` | 王建国 | 仓库人员 |

推荐走一遍：林小雨发起退货 → 苏晴同意退回 → 林小雨填寄回单号 → 王建国收货并登记验货 → 苏晴处理完成。

---

## 4. 常用命令

| 目的 | 命令 |
| --- | --- |
| 启动（后台） | `docker compose up -d` |
| 首次启动 / 改代码后重建 | `docker compose up -d --build` |
| 看运行状态 | `docker compose ps` |
| 实时看日志 | `docker compose logs -f app` |
| 只看数据库日志 | `docker compose logs -f mysql` |
| 重启应用 | `docker compose restart app` |
| 停止并删除容器（**保留数据**） | `docker compose down` |
| 停止并删除容器 + **清空数据** | `docker compose down -v` |
| 重置演示数据（容器内执行） | `docker compose exec app npm run reset` |
| 在容器里跑验收测试 | `docker compose exec app npm test` |
| 进入应用容器 | `docker compose exec app sh` |
| 进入 MySQL 命令行 | `docker compose exec mysql mysql -uroot -p cloth_demo_2026` |
| 查看镜像 | `docker images clothes-after-sale` |

> `npm run reset` 会删库重建，只在演示数据被改乱时用；它需要 DDL 权限，所以默认用 root 账号。

---

## 5. 数据怎么保存和迁移

数据放在 Docker 命名卷 `clothes-mysql-data` 里，**删容器、重启、重新构建镜像都不会丢**。

### 备份

```bash
docker exec clothes-mysql sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --databases clothes_after_sale --single-transaction' \
  > backup-$(date +%Y%m%d).sql
```

### 恢复

```bash
docker exec -i clothes-mysql sh -c \
  'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' < backup-20261026.sql
```

### 换机器迁移

```bash
# 旧机器：导出数据
docker exec clothes-mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --databases clothes_after_sale --single-transaction' > backup.sql

# 新机器：起容器后导入
docker compose up -d
docker exec -i clothes-mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' < backup.sql
docker compose restart app
```

---

## 6. 改配置

配置全部通过环境变量传入，**不用改代码**。

| 想改什么 | 怎么做 |
| --- | --- |
| 换访问端口 | `APP_PORT=8080 docker compose up -d`（Windows PowerShell 用 `$env:APP_PORT=8080`） |
| 换数据库密码 | 首次启动前设置 `MYSQL_ROOT_PASSWORD=你的密码`；已启动过则必须先 `down -v` |
| 数据库对本机开放端口 | 默认 `127.0.0.1:3307`，改 `MYSQL_PUBLISH_PORT` |
| 固定配置不每次敲 | 在项目根目录新建 `.env.docker`？**不推荐**——`docker compose` 会自动读项目里的 `.env`，而那份是给 `npm start` 用的，容易串味。建议直接写进 `docker-compose.yml` 的 `environment` |

⚠️ **密码改了但连不上**：MySQL 只在数据卷为空时才会用 `MYSQL_ROOT_PASSWORD` 初始化。卷里已经有旧密码，新密码不生效。正确做法：

```bash
docker compose down -v      # 删容器 + 删数据卷
docker compose up -d --build
```

---

## 7. 把镜像带走（离线交付）

如果目标机器不能联网，或者不想在对方机器上重新构建，可以把镜像导出成文件。

### 7.1 导出 / 导入

```bash
# 构建
docker compose build

# 导出（压缩后约 60~80 MB）
docker save clothes-after-sale:1.1.0 | gzip > clothes-after-sale-1.1.0.tar.gz

# 拷贝到目标机器后导入
docker load -i clothes-after-sale-1.1.0.tar.gz
docker images clothes-after-sale
```

目标机器还需要 `docker-compose.yml`（里面 `build:` 会被已有的 `image:` 直接复用，仍然建议执行 `docker compose up -d`，它会自动跳过构建）。

如果目标机器只想单跑这一个容器、数据库用现成的 MySQL：

```bash
docker run -d --name clothes-app \
  -p 3000:3000 \
  -e DB_HOST=192.168.1.10 \
  -e DB_PORT=3306 \
  -e DB_USER=root \
  -e DB_PASSWORD=你的密码 \
  -e DB_NAME=clothes_after_sale \
  -e TZ=Asia/Shanghai \
  --restart unless-stopped \
  clothes-after-sale:1.1.0
```

> 单跑容器时，目标库必须能被应用访问；库不存在且账号有 `CREATE` 权限时会自动建库。

### 7.2 推到镜像仓库，另一台机器直接拉

适合"我在这台机器构建，同学/老师在另一台机器 `docker pull` 就能跑"。

```bash
# 1. 打标签：<仓库地址>/<命名空间>/<镜像名>:<版本>
docker tag clothes-after-sale:1.1.0 fengzixuan/clothes-after-sale:1.1.0

# 2. 登录（首次需要，Docker Hub 或阿里云容器镜像服务都行）
docker login

# 3. 推送
docker push fengzixuan/clothes-after-sale:1.1.0
```

目标机器拉取并运行：

```bash
docker pull fengzixuan/clothes-after-sale:1.1.0
```

然后把 `docker-compose.yml` 里 `app` 服务的 `build:` 去掉，改成镜像地址：

```yaml
  app:
    image: fengzixuan/clothes-after-sale:1.1.0
    # build:            ← 删掉这两行
    #   context: .
    container_name: clothes-app
```

之后同样 `docker compose up -d` 即可。数据库仍然由 compose 里的 `mysql` 服务提供，不需要额外配置。

> 国内推送 Docker Hub 较慢时，可用阿里云容器镜像服务（免费）：`registry.cn-hangzhou.aliyuncs.com/你的命名空间/clothes-after-sale:1.1.0`，推送前先 `docker login registry.cn-hangzhou.aliyuncs.com`。

---

## 8. 常见问题

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `docker: command not found` | 没装 Docker 或没启动 | 装 Docker Desktop，启动后重开终端 |
| `docker compose` 提示未知命令 | Compose 版本太老 | 用 `docker-compose`（带横线） |
| `Bind for 0.0.0.0:3000 failed: port is already allocated` | 3000 被本机 `npm start` 或其他程序占用 | `APP_PORT=8080 docker compose up -d` |
| `clothes-mysql` 一直 `unhealthy` | 首次初始化慢，或磁盘/权限问题 | `docker compose logs mysql` 看具体报错，通常等 1 分钟即可 |
| app 日志报 `ER_ACCESS_DENIED_ERROR` | 数据卷里是旧密码 | `docker compose down -v` 后重新 `up` |
| app 日志报 `ECONNREFUSED mysql:3306` | MySQL 还没就绪（少见，已配健康检查） | `docker compose restart app` |
| 页面能开但时间是 UTC，差 8 小时 | 容器时区没设 | 确认 `TZ=Asia/Shanghai`，`docker compose exec app date` 检查 |
| 拉 `mysql:8.0` 卡住 | 网络 | Docker Desktop → Settings → Docker Engine 配镜像加速地址，或 `docker pull` 前先配代理 |
| 构建时 `npm ci` 失败 | 网络或 lock 文件不匹配 | 本机 `npm install` 后重新 `--build`；确认 `package-lock.json` 已提交 |
| 改了代码但页面没变 | 代码在镜像里，不会热更新 | `docker compose up -d --build` |
| 重启后要重新登录 | 会话存在内存里（设计如此） | 重新登录即可，不影响数据 |

---

## 9. 容器方式 vs 本地直跑

| 对比项 | `npm start`（本地） | `docker compose up`（容器） |
| --- | --- | --- |
| 需要预装 | Node.js 22 + MySQL 8 | 只要 Docker |
| 数据库 | 用本机 MySQL，读 `.env` | 用容器内 MySQL，读 compose 环境变量 |
| 端口 | 3000 | 3000（可改 `APP_PORT`） |
| 代码修改 | 改完重启即可 | 必须 `--build` 重建镜像 |
| 数据位置 | 本机 MySQL 数据目录 | Docker 卷 `clothes-mysql-data` |
| 交付给别人 | 对方要装 Node 和 MySQL | 对方 `docker compose up -d` 或 `docker load` 即可 |
| 适用场景 | 日常开发调试 | 演示、交付、换机运行 |

两种方式**互不影响**：容器里的 MySQL 映射到本机 3307，不会和本机 3306 的 MySQL 打架；本地 `.env` 也不会被容器读取。

---

## 10. 交付清单

容器化相关的文件一共三个，都已随仓库提交：

```
Clothes/
├─ Dockerfile            # 应用镜像：多阶段构建、非 root、内置健康检查
├─ docker-compose.yml    # 应用 + MySQL 编排、数据卷、启动依赖
├─ .dockerignore         # 排除 node_modules/.env/docs，避免密码进镜像
└─ docs/Docker部署说明.md  # 本文件
```

一键验证（目标机器上）：

```bash
docker compose up -d --build && docker compose ps
# 两个服务都 healthy 后访问 http://localhost:3000
```
