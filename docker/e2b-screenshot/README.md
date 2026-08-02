# 截图沙盒模板（SLIDERULE_E2B_TEMPLATE）

应用中心卡片的第一级缩略图是 E2B 沙盒里真浏览器截的图（见
`slide-rule-python/services/app_shot_backfill.py`）。默认模板不带 playwright，
每个一次性沙盒都要现装——**实测 +29.1s/次**。把它烤进自定义模板即可省掉。

## 建模板

```bash
npm install -g @e2b/cli
export E2B_API_KEY=...            # 与运行时同一个 key
cd docker/e2b-screenshot
e2b template create sliderule-playwright \
  --cpu-count 2 --memory-mb 2048 \
  --cmd "sudo /root/.jupyter/start-up.sh" \
  --ready-cmd "until (echo > /dev/tcp/localhost/49999) 2>/dev/null; do sleep 1; done"
```

建完把名字填进 `SLIDERULE_E2B_TEMPLATE`。**不需要本地 Docker**——E2B 在服务端
构建（实测 47~63s）。

## 三条踩过的坑（都写在 Dockerfile 注释里，这里只列结论）

1. `--cmd` / `--ready-cmd` **必须给且必须成对**，且启动命令要带 `sudo`——
   基础镜像末尾是 `USER user`，直接执行 root 的 start-up.sh 是 126
   Permission denied，49999 端口不开，`run_code` 一律超时。
2. **不能靠 ENV 传路径**。start-up.sh 是 sudo 拉起的，sudo 默认剥环境变量，
   Dockerfile 里的 `NODE_PATH` / `PLAYWRIGHT_BROWSERS_PATH` 在 `run_code` 的
   子进程里全是 None。所以模块放 `/node_modules`（Node 解析会上溯到根）、
   浏览器从两个身份的默认缓存位置各软链一次。
3. `cd / && npm install` 会撞 npm 自己的 `Tracker "idealTree" already exists`，
   要先装到别处再 `mv`。

## 验证

```
沙盒启动 2.0s（默认模板 0.3s，但随后要现装 29.1s）
chromium 首次 launch 19.6s → CHROMIUM_OK 149.0.7827.55
整条 capture_app_screenshot：桌面 24.9s / 手机 29.6s
```
