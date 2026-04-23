# 设计文档：获取设备信息节点

## 设计概述

`get_device_info` 属于宿主设备能力节点，在 Cube 桌面/浏览器环境中价值有限，优先级较低。
本轮采用“服务端安全降级版”设计：优先从当前请求头与 Client Hints 中提取设备环境摘要，若宿主未提供这些信号，则退化为可选 hint 输出，不阻断整体编排流程。

## 接口映射

- `web-aigc` 节点：`get_device_info`
- Cube 承接：服务端 `get-device-info` route + node adapter，后续可由宿主前端补充 richer hints

## 运行流程

1. 读取当前请求头中的 `sec-ch-ua / sec-ch-ua-platform / sec-ch-ua-mobile / accept-language / x-user-timezone / user-agent`
2. 若宿主未上送足够信号，则使用 `localeHint / timezoneHint / runtimeHint` 做兼容退化
3. 对原始高风险字段执行隐私过滤，不返回 `user-agent / ip / cookie / authorization / sec-ch-ua-model` 原文
4. 输出 `hostRuntime / deviceClass / browserFamily / osFamily / locale / timezone / compatibility / privacy` 结构化摘要
5. 供下游节点使用，并为后续主线程接入 `server/index.ts` 留出独立 route
