#!/bin/bash

# ⚡ FastImg One-Click Deployment Script

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}Starting FastImg Deployment...${NC}"

# 1. 检查 Docker 环境
if ! [ -x "$(command -v docker)" ]; then
  echo -e "${RED}Error: Docker 未安装${NC}"
  echo "请先安装 Docker: curl -fsSL https://get.docker.com | bash"
  exit 1
fi

# 2. 准备目录
PROJECT_NAME="fastimg"
if [ -d "$PROJECT_NAME" ]; then
    echo "Updating existing installation..."
    cd $PROJECT_NAME
    git pull origin main
else
    echo "Cloning repository..."
    git clone https://github.com/bwwq/fastimg.git $PROJECT_NAME
    cd $PROJECT_NAME
fi

# 3. 创建必要目录
mkdir -p uploads data

# 4. 启动容器
echo "Building and starting containers..."
if docker compose version >/dev/null 2>&1; then
    CMD="docker compose"
else
    CMD="docker-compose"
fi

$CMD up -d --build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}=====================================${NC}"
    echo -e "${GREEN}   ✅ FastImg 部署成功!             ${NC}"
    echo -e "${GREEN}=====================================${NC}"
    echo -e "访问地址: http://localhost:5000 (或服务器IP)"
    echo -e "管理员: 第一个注册的用户自动获得管理员权限"
else
    echo -e "${RED}部署失败，请检查日志${NC}"
fi
