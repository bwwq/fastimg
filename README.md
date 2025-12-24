# ⚡ FastImg

一个轻量级、现代化、抗打击的图床应用，专为 VPS 部署设计。

![Python](https://img.shields.io/badge/Python-3.9+-blue.svg)
![Flask](https://img.shields.io/badge/Flask-2.x-lightgrey.svg)
![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

<div align="center">
  <img src="screenshots/home.png" alt="Home Page" width="800">
</div>

## ✨ 特性

- **现代化 UI / UX**:
  - 🎨 **极简设计**: 默认 Slate 灰，内置 Stone, Zinc, Light 等多款优雅主题。
  - 🖼️ **瀑布流与列表视图**: 丝滑的图片浏览体验，支持多种排序方式（时间、大小、名称）。
  - 📱 **完全响应式**: 完美适配桌面与移动端设备。

- **强大的上传功能**:
  - 📤 **批量上传**: 支持多文件拖拽上传，带有实时进度队列。
  - 🎚️ **自定义压缩**: 用户可调节上传质量（受管理员设定的上限控制），平衡画质与体积。
  - 🛡️ **安全检测**: 基于文件头的格式检查 (Magic Bytes) 与解压炸弹防御。

- **系统管理**:
  - 👥 **用户管理**: 管理员可查看、禁用、删除用户，修改用户角色。
  - 🔑 **邀请码机制**: 支持生成一次性或限次邀请码，控制注册用户。
  - ⚙️ **动态配置**: 管理员可在 Web 界面实时调整上传限制、压缩质量、水印设置等。
  - 🛡️ **安全防护**: 内置 Flask-Limiter 接口限流，自动移除 EXIF 隐私信息。

## 📸 界面预览

| 瀑布流图库 | 上传队列 |
|:---:|:---:|
| <img src="screenshots/gallery.png" width="400"> | <img src="screenshots/upload.png" width="400"> |

| 管理配置 | 用户管理 |
|:---:|:---:|
| <img src="screenshots/settings.png" width="400"> | <img src="screenshots/home.png" width="400"> |

## 🚀 快速开始

### 本地开发

```bash
# 1. 克隆项目
git clone https://github.com/your-username/image-host.git
cd image-host

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动应用
python app.py
```

访问 `http://localhost:5000`，第一个注册的用户自动成为管理员。

---

## 🐳 Docker 部署 (推荐)

### 方式一：Docker Compose

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f
```

### 方式二：手动 Docker

```bash
# 构建镜像
docker build -t imghost .

# 启动容器
docker run -d \
  --name imghost \
  -p 5000:5000 \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/database.db:/app/database.db \
  imghost
```

---

## 🌐 生产部署 + 反向代理

### 使用 Nginx 反向代理

1. **安装 Nginx**
   ```bash
   sudo apt update && sudo apt install nginx -y
   ```

2. **配置 Nginx** (`/etc/nginx/sites-available/imghost`)
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;  # 替换为你的域名

       client_max_body_size 50M;  # 允许上传大文件

       location / {
           proxy_pass http://127.0.0.1:5000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # 静态文件缓存优化
       location /i/ {
           proxy_pass http://127.0.0.1:5000;
           proxy_cache_valid 200 7d;
           add_header Cache-Control "public, max-age=604800";
       }
   }
   ```

3. **启用配置**
   ```bash
   sudo ln -s /etc/nginx/sites-available/imghost /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

### 使用 Caddy (更简单，自动 HTTPS)

1. **安装 Caddy**
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install caddy -y
   ```

2. **配置 Caddyfile** (`/etc/caddy/Caddyfile`)
   ```
   your-domain.com {
       reverse_proxy localhost:5000
   }
   ```

3. **重启 Caddy**
   ```bash
   sudo systemctl restart caddy
   ```

> Caddy 会自动申请并续期 Let's Encrypt SSL 证书！

### 使用 Nginx Proxy Manager (Docker 图形界面)

如果你使用 Docker 部署多个服务，推荐使用 [Nginx Proxy Manager](https://nginxproxymanager.com/)：

1. 按官方文档部署 NPM
2. 添加 Proxy Host：
   - **Domain**: `your-domain.com`
   - **Forward Host**: `imghost` (Docker 容器名) 或 `host IP`
   - **Forward Port**: `5000`
   - **SSL**: 启用 Let's Encrypt

---

## 🛠️ 管理员指南

- **成为管理员**: 系统**第一个注册**的用户将自动获得管理员权限。
- **管理面板**: 登录后点击侧边栏 "系统设置"。
- **功能**:
  | 标签页 | 功能 |
  |--------|------|
  | 系统配置 | 上传限制、压缩质量、WebP 转换、水印设置 |
  | 用户管理 | 查看用户、修改角色、禁用/删除用户 |
  | 邀请码 | 生成/管理邀请码 |

---

## 📂 目录结构

```
.
├── app.py              # 后端核心逻辑
├── models.py           # 数据库模型
├── utils.py            # 图片处理与安全工具
├── config.py           # 配置文件
├── extensions.py       # 扩展初始化
├── uploads/            # 图片存储目录 (需备份)
├── database.db         # SQLite 数据库 (需备份)
├── static/             # 前端资源
│   ├── css/            # 模块化样式 (base, components, layout, themes)
│   ├── js/             # 前端逻辑
│   └── index.html      # 单页应用入口
├── screenshots/        # 项目截图
├── Dockerfile          # Docker 镜像构建
└── docker-compose.yml  # 容器编排
```

---

## 🔧 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SECRET_KEY` | Flask 密钥 | 自动生成 |
| `UPLOAD_FOLDER` | 图片存储路径 | `./uploads` |

---

## 📝 License

MIT
