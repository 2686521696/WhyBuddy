# 应用中心真截图用的沙盒模板：把 playwright + chromium 预先烤进去，
# 省掉每个一次性沙盒现装的 29.1s。
#
# 基座必须是 code-interpreter：services/app_screenshot.py 全程走
# sandbox.run_code()（e2b_code_interpreter）。建模板时要显式带上它的启动命令
# `sudo /root/.jupyter/start-up.sh`——镜像末尾是 USER user，不加 sudo 会
# Permission denied，49999 端口不开，run_code 一律超时。
FROM e2bdev/code-interpreter:latest

# 版本跟 app_screenshot._PLAYWRIGHT_VERSION 对齐，行为可预期。
ENV PLAYWRIGHT_VERSION=1.61.1

# ⚠️ 这个模板**不能靠 ENV 传路径**。实测：start-up.sh 是用 sudo 拉起的，
# sudo 默认剥掉环境变量，所以 Dockerfile 里 ENV 的 NODE_PATH /
# PLAYWRIGHT_BROWSERS_PATH 在 run_code 的子进程里全是 None。
# 于是两样东西都放到"不需要任何环境变量就能被找到"的位置：
#
#   ① 模块装进 /node_modules —— Node 的模块解析会一路上溯到文件系统根，
#      所以 require("playwright") 在任意 cwd 都能解析到（截图脚本 cwd=/tmp，
#      而 /tmp 是运行期新建的，镜像里往那儿放东西不会留下）。
#   ② 浏览器装进 /opt/pw-browsers，再从两个身份的默认缓存位置各软链一次。
#      playwright 不带 env 时就查 ~/.cache/ms-playwright——run_code 是 root，
#      commands.run 是 user，两边都链上就都能用。
# 先装进 /opt/pw 再把 node_modules 搬到根：直接 `cd / && npm install` 会撞
# npm 自己的 `Tracker "idealTree" already exists`（它从根目录往上走时会打结）。
RUN mkdir -p /opt/pw \
 && cd /opt/pw \
 && npm install playwright@${PLAYWRIGHT_VERSION} \
 && mv /opt/pw/node_modules /node_modules \
 && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright install --with-deps chromium \
 && chmod -R a+rX /node_modules /opt/pw-browsers \
 && mkdir -p /root/.cache /home/user/.cache \
 && ln -sfn /opt/pw-browsers /root/.cache/ms-playwright \
 && ln -sfn /opt/pw-browsers /home/user/.cache/ms-playwright
