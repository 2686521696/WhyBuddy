# docker/certs — 可选企业根证书

公网环境不需要动这个目录，保持为空即可。

如果你的构建机在企业内网、出口走 TLS 拦截（MITM）代理，`docker build`
阶段的 `pnpm install` / `pip install` 会报证书校验失败。把你们的根证书
（PEM 格式，扩展名 `.crt`）放进本目录再构建即可——两个镜像会把这里的
证书并进系统信任链，并让 Node（`NODE_EXTRA_CA_CERTS`）与 Python
（`PIP_CERT`/`SSL_CERT_FILE`）都指向它。

`*.crt` 已被 .gitignore 排除，证书只进你本地的构建，不会被提交。
