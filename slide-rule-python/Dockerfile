# SlideRule Python 推演后端（FastAPI :9700）— 生产镜像
#
# 构建上下文是仓库根目录（docker compose 已配好）：
#   docker build -f slide-rule-python/Dockerfile -t sliderule-python:local .
#
# 会话数据默认落 /app/data/sliderule-sessions.json —— compose 用命名卷
# 持久化该目录，容器重建不丢会话。

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 可选企业根证书（内网 MITM 代理环境）：把 PEM 证书放进 docker/certs/
# 再构建即可；目录为空时下面两步是空操作，不影响正常环境。
COPY docker/certs/ /usr/local/share/ca-certificates/sliderule/
RUN sh -c 'cat /usr/local/share/ca-certificates/sliderule/*.crt >> /etc/ssl/certs/ca-certificates.crt 2>/dev/null || true'
ENV PIP_CERT=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

# 依赖层先行，源码改动不重装依赖
COPY slide-rule-python/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY slide-rule-python/ ./

EXPOSE 9700

# 绑 :: = IPv4+IPv6 双栈（Railway 等平台的服务间私网是 IPv6-only，只绑 0.0.0.0
# 会导致 Node 侧走 *.railway.internal 连不进来 → 502；:: 同时兼容 compose 的
# IPv4 桥接网，两边都能用）。端口听平台注入的 $PORT，没有就回落 9700（compose
# 里设了 PORT=9700，健康检查照旧命中）。用 sh -c + exec 保证 uvicorn 是 PID 1、
# 正常接收 SIGTERM 优雅退出。
CMD ["sh", "-c", "exec python -m uvicorn app:app --host :: --port ${PORT:-9700}"]
