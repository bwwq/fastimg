FROM python:3.9-slim

WORKDIR /app

# 安装系统依赖 (如果有需要 Pillow 编译的库)
# slim 版本通常已经够用，如果Pillow报错可能需要 libjpeg-dev zlib1g-dev
RUN apt-get update && apt-get install -y \
    libjpeg-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 创建必要的目录并设置权限
RUN mkdir -p uploads && chmod 777 uploads
# SQLite 数据库文件如果生成在根目录，也需要写权限，建议将 db 放在 data 目录挂载
# 这里为了简单，假设 db 生成在 /app 下

ENV FLASK_APP=app.py
ENV PYTHONUNBUFFERED=1

EXPOSE 5000

# Gunicorn 启动命令
# 4 workers, gevent worker class (if installed) or sync
# bind 0.0.0.0:5000
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]
