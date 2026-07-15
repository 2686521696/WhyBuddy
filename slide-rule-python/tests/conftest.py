"""全套件测试基线环境（P2a 引入，2026-07-16）。

外呼工具（web.search 真搜索）在测试里全局关闭：测试必须确定性、
不碰网络（CI 无凭据也要绿；维基/搜索供应商的延迟与波动不进测试）。
需要验证工具行为的测试自行 monkeypatch 开关与供应商（见
test_mcp_tools.py）；需要真网络的活体冒烟用
SLIDERULE_LIVE_WEB_TESTS=1 显式开。
"""

import os

os.environ.setdefault("SLIDERULE_WEB_SEARCH", "off")
