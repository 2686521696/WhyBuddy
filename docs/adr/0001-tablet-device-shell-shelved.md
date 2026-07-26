# 平板设备壳下架（代码保留、入口封死）

## Context and Problem Statement

应用舞台做了桌面/平板/手机三档设备壳（`AppRuntimeScreen.tsx` 的 `DEVICE_SPECS`
三档规格、平板主从双栏范式 `app-runtime-tablet-split` 都已实现）。但平板档的
真实使用价值存疑：企业应用的真实用户几乎全在桌面/手机两端，平板档每多一档
就多一份视觉调校与测试负担。图上"桌面/平板/手机原生壳(preferredDevice)"的
表述与实际可达路径不一致，审查时被判为图码不符。

## Considered Options

* 三档全开（补齐平板档的调校与测试）
* 删除平板代码
* 下架但保留代码：`preferredDevice === "tablet"` 按未声明处理，切换条只渲染桌面/手机

## Decision Outcome

Chosen option: "下架但保留代码"。按用户裁决从切换条下架（见
`AppRuntimeScreen.tsx` 切换条处注释）；schema 三档仍合法（`tablet` 声明不报错、
不炸门），渲染代码保留，未来要重启平板档只需恢复入口两处。

### Consequences

* Good: 维护面收敛到两档；历史模型声明 `tablet` 不会失败。
* Bad: 平板范式代码是"死代码"，有腐化风险——重启前需重新走一遍视觉验收。
