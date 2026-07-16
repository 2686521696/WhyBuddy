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

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9700"]
