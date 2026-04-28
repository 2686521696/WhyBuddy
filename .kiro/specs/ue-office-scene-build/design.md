# 设计文档：UE 办公室场景搭建

## 概述

UE5 办公室场景是整个 UE 集成的视觉基础。设计上以 Three.js OfficeRoom 为参考蓝本，在 UE5 中使用 Kenney Furniture Kit 风格的低多边形资产重建办公室。场景采用模块化搭建方式，每个功能区域（工位区、会议区、休息区）作为独立子关卡，便于后续扩展和性能优化。

关键设计决策：
- 使用 World Partition 或子关卡管理不同区域，支持按需加载
- 材质使用 Master Material + Material Instance 模式，统一管理
- 灯光使用 Lumen GI，辅以 Rect Light 做局部补光

## 架构

```
Content/CubePets/
├── Environment/
│   ├── Office/
│   │   ├── Meshes/          # 静态网格体
│   │   │   ├── SM_Desk_01
│   │   │   ├── SM_Chair_01
│   │   │   └── SM_Shelf_01
│   │   ├── Materials/        # 材质与材质实例
│   │   │   ├── MM_Office_Master
│   │   │   ├── MI_Wood_Light
│   │   │   └── MI_Fabric_Blue
│   │   ├── Textures/         # 贴图
│   │   │   ├── T_Wood_BC
│   │   │   ├── T_Wood_N
│   │   │   └── T_Wood_ORM
│   │   ├── Blueprints/       # 可交互物体蓝图
│   │   │   ├── BP_Desk
│   │   │   └── BP_Whiteboard
│   │   └── Lighting/         # 灯光预设
│   │       ├── BP_DayLight
│   │       └── BP_NightLight
│   └── Props/                # 通用道具
├── Maps/
│   ├── L_Office_Main         # 主关卡
│   ├── L_Office_WorkArea     # 工位区子关卡
│   └── L_Office_MeetingRoom  # 会议室子关卡
```

## 组件与接口

### 场景区域定义

| 区域 | 包含物体 | 对应 Three.js 组件 |
|------|---------|-------------------|
| 工位区 | 4 张办公桌、4 把椅子、显示器、键盘 | OfficeRoom.desks |
| 会议区 | 会议桌、6 把椅子、白板、投影幕 | OfficeRoom.meetingArea |
| 休息区 | 沙发、茶几、饮水机 | OfficeRoom.lounge |
| 走廊 | 书架、绿植、装饰画 | OfficeRoom.corridor |

### 灯光接口

```typescript
// 通过指令协议控制灯光
interface LightingCommand {
  method: 'scene.setLighting';
  params: {
    preset: 'day' | 'night' | 'meeting' | 'presentation';
    intensity?: number;  // 0.0 - 2.0
    colorTemp?: number;  // 2700K - 6500K
  };
}
```

## 正确性属性

1. **布局一致性**：UE5 场景中每个家具的相对位置与 Three.js 版本的偏差不超过 5%。
2. **资产完整性**：资产清单中列出的每个模型在 UE5 项目中都有对应文件。
3. **性能基线**：场景在目标最低配置（GTX 1060）上的帧率不低于 30fps。

## 测试策略

- **视觉对比**：截图对比 UE5 场景与 Three.js 场景的布局一致性
- **性能测试**：在不同 GPU 上运行场景，记录帧率与显存占用
- **资产审计**：脚本扫描项目目录，验证命名规范与目录结构
