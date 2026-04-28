# 场景指令协议文档

## 概述

场景指令协议定义了 LLM 导演模块与 UE5 渲染引擎之间的通信格式。协议基于 **JSON-RPC 2.0 over WebSocket**，支持请求-响应与通知两种模式。

协议层负责：
- 指令格式定义与参数校验
- 错误码与可重试标记
- 批量请求支持
- 自定义扩展指令

## 传输通道

- 协议：WebSocket 长连接，双向通信
- 编码：JSON（UTF-8）
- 每条指令包含唯一 `id`，用于追踪执行结果

## 指令格式

### 请求

```json
{
  "jsonrpc": "2.0",
  "method": "character.moveTo",
  "params": {
    "characterId": "hero",
    "x": 100,
    "y": 0,
    "z": -50
  },
  "id": "req-001"
}
```

| 字段     | 类型   | 必填 | 说明                                |
|----------|--------|------|-------------------------------------|
| jsonrpc  | string | 是   | 固定为 `"2.0"`                      |
| method   | string | 是   | 指令方法名                          |
| params   | object | 是   | 指令参数                            |
| id       | string | 是   | 请求唯一标识，用于匹配响应          |

### 响应（成功）

```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "duration": 1500
  },
  "id": "req-001"
}
```

### 响应（失败）

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "指令执行超时",
    "retryable": true
  },
  "id": "req-001"
}
```

### 通知（无响应）

```json
{
  "jsonrpc": "2.0",
  "method": "scene.heartbeat",
  "params": { "timestamp": 1700000000 }
}
```

通知消息不包含 `id` 字段，服务端不会返回响应。

### 批量请求

将多条请求放入 JSON 数组中发送：

```json
[
  { "jsonrpc": "2.0", "method": "effect.play", "params": { "effectId": "fire" }, "id": "b-1" },
  { "jsonrpc": "2.0", "method": "effect.stop", "params": { "effectId": "smoke" }, "id": "b-2" }
]
```

## 指令类型

### character.moveTo

移动角色到指定坐标。

| 参数        | 类型   | 必填 | 说明                     |
|-------------|--------|------|--------------------------|
| characterId | string | 是   | 角色标识                 |
| x           | number | 是   | 目标 X 坐标             |
| y           | number | 是   | 目标 Y 坐标             |
| z           | number | 是   | 目标 Z 坐标             |
| speed       | number | 否   | 移动速度（正数）         |

```json
{
  "jsonrpc": "2.0",
  "method": "character.moveTo",
  "params": { "characterId": "hero", "x": 100, "y": 0, "z": -50, "speed": 300 },
  "id": "move-1"
}
```

### character.playAnimation

触发角色播放动画。

| 参数          | 类型    | 必填 | 说明                       |
|---------------|---------|------|----------------------------|
| characterId   | string  | 是   | 角色标识                   |
| animationName | string  | 是   | 动画名称                   |
| loop          | boolean | 否   | 是否循环播放               |
| blendTime     | number  | 否   | 混合过渡时间（≥0）         |

```json
{
  "jsonrpc": "2.0",
  "method": "character.playAnimation",
  "params": { "characterId": "hero", "animationName": "wave", "loop": false },
  "id": "anim-1"
}
```

### camera.setPreset

切换到预设镜头。

| 参数       | 类型   | 必填 | 说明         |
|------------|--------|------|--------------|
| presetName | string | 是   | 预设名称     |

```json
{
  "jsonrpc": "2.0",
  "method": "camera.setPreset",
  "params": { "presetName": "closeup" },
  "id": "cam-1"
}
```

### camera.transition

镜头平滑过渡到目标位置。

| 参数           | 类型   | 必填 | 说明                                |
|----------------|--------|------|-------------------------------------|
| targetPosition | object | 是   | 目标位置 `{ x, y, z }`             |
| targetRotation | object | 否   | 目标旋转 `{ pitch, yaw, roll }`    |
| duration       | number | 是   | 过渡时长（秒，正数）               |
| easing         | string | 否   | 缓动函数名称                       |

```json
{
  "jsonrpc": "2.0",
  "method": "camera.transition",
  "params": {
    "targetPosition": { "x": 0, "y": 10, "z": 5 },
    "targetRotation": { "pitch": -15, "yaw": 90, "roll": 0 },
    "duration": 2.5,
    "easing": "easeInOut"
  },
  "id": "cam-2"
}
```

### scene.setState

设置场景状态变量。

| 参数  | 类型    | 必填 | 说明         |
|-------|---------|------|--------------|
| key   | string  | 是   | 状态键名     |
| value | unknown | 是   | 状态值       |

```json
{
  "jsonrpc": "2.0",
  "method": "scene.setState",
  "params": { "key": "weather", "value": "rainy" },
  "id": "state-1"
}
```

### effect.play

播放特效。

| 参数     | 类型   | 必填 | 说明                       |
|----------|--------|------|----------------------------|
| effectId | string | 是   | 特效标识                   |
| position | object | 否   | 播放位置 `{ x, y, z }`    |
| scale    | number | 否   | 缩放比例（正数）           |

```json
{
  "jsonrpc": "2.0",
  "method": "effect.play",
  "params": { "effectId": "explosion", "position": { "x": 0, "y": 0, "z": 0 }, "scale": 2.0 },
  "id": "fx-1"
}
```

### effect.stop

停止特效。

| 参数     | 类型   | 必填 | 说明                       |
|----------|--------|------|----------------------------|
| effectId | string | 是   | 特效标识                   |
| fadeOut  | number | 否   | 淡出时间（秒，≥0）        |

```json
{
  "jsonrpc": "2.0",
  "method": "effect.stop",
  "params": { "effectId": "explosion", "fadeOut": 0.5 },
  "id": "fx-2"
}
```

## 自定义扩展指令

协议支持自定义扩展指令类型。自定义方法名不在内置列表中时，参数校验将被跳过，由业务层自行处理。

```json
{
  "jsonrpc": "2.0",
  "method": "custom.triggerCutscene",
  "params": { "cutsceneId": "intro", "skipEnabled": true },
  "id": "custom-1"
}
```

## 错误码

| 错误码  | 名称              | 说明             | 可重试 |
|---------|--------------------|------------------|--------|
| -32600  | INVALID_REQUEST    | 请求格式不合法   | 否     |
| -32601  | METHOD_NOT_FOUND   | 指令类型不存在   | 否     |
| -32602  | INVALID_PARAMS     | 参数校验失败     | 否     |
| -32000  | EXECUTION_FAILED   | UE 侧执行失败   | 是     |
| -32001  | TIMEOUT            | 指令执行超时     | 是     |
| -32002  | QUEUE_FULL         | 队列已满         | 否     |
| -32003  | NOT_CONNECTED      | UE 连接不可用   | 是     |

错误响应中的 `retryable` 字段标识调用方是否可以安全重试该请求。

## TypeScript 使用示例

```typescript
import {
  createCommand,
  createSuccessResult,
  createErrorResult,
  validateCommand,
  validateParams,
  isKnownMethod,
  isRetryable,
  SCENE_ERROR_CODES,
} from "@shared/scene-command";

// 创建指令
const cmd = createCommand("character.moveTo", {
  characterId: "hero",
  x: 100, y: 0, z: -50,
});

// 校验请求格式
const baseResult = validateCommand(cmd);
if (!baseResult.success) {
  // 请求格式不合法
}

// 校验参数
const paramResult = validateParams(cmd.method, cmd.params);
if (!paramResult.success) {
  // 参数校验失败，paramResult.error 包含详细信息
}

// 判断是否为已知方法
if (!isKnownMethod(cmd.method)) {
  // 自定义扩展指令，跳过内置参数校验
}

// 创建成功响应
const successRes = createSuccessResult(cmd.id, { success: true, duration: 500 });

// 创建错误响应
const errorRes = createErrorResult(
  cmd.id,
  SCENE_ERROR_CODES.TIMEOUT,
  "指令执行超时",
);
// errorRes.error.retryable === true

// 判断错误是否可重试
if (errorRes.error && isRetryable(errorRes.error.code)) {
  // 可以安全重试
}
```
