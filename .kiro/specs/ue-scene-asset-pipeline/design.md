# 设计文档：场景资产管线

## 概述

场景资产管线负责 UE5 资产的全生命周期管理。设计上采用"Git LFS 版本管理 + Pak 文件打包 + HTTP 增量分发"的架构。

关键设计决策：
- 使用 Git LFS 管理大型二进制资产
- 使用 UE5 Pak 文件格式打包，支持挂载和卸载
- 增量更新基于文件哈希比对

## 组件与接口

### 资产清单

```typescript
interface AssetManifest {
  version: string;
  packages: Array<{
    name: string;
    files: Array<{ path: string; hash: string; size: number }>;
    totalSize: number;
  }>;
}
```

### 命名规范

| 类型 | 前缀 | 示例 |
|------|------|------|
| 静态网格 | SM_ | SM_Desk_01 |
| 骨骼网格 | SK_ | SK_Pet_Cat |
| 材质 | M_ | M_Wood_Master |
| 材质实例 | MI_ | MI_Wood_Light |
| 贴图 | T_ | T_Wood_BC |
| 蓝图 | BP_ | BP_InteractiveDesk |
| 动画序列 | AS_ | AS_Pet_Walk |
| 动画蓝图 | ABP_ | ABP_Pet |

## 正确性属性

1. **哈希一致性**：下载的资产文件哈希必须与清单中记录的一致。
2. **版本可回滚**：任何版本的资产包都可以被完整恢复。

## 测试策略

- **单元测试**：清单生成、哈希计算、增量 diff
- **集成测试**：打包 → 上传 → 增量下载 → 挂载的完整流程
