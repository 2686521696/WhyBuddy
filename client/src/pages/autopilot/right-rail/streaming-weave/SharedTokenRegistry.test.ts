/**
 * SharedTokenRegistry 单元测试
 *
 * 验证共享 Token 注册表的核心行为：
 * - getOrCreate 创建与复用消费端条目
 * - appendToAll 将 token 追加到所有消费端
 * - getContent 获取指定消费端累积文本
 * - reset 重置指定消费端
 * - remove 移除消费端
 * - clear 清空所有注册
 */

import { describe, expect, it } from "vitest";

import { SharedTokenRegistry } from "./SharedTokenRegistry";

describe("SharedTokenRegistry", () => {
  it("初始状态 size 为 0", () => {
    const registry = new SharedTokenRegistry();
    expect(registry.size).toBe(0);
  });

  it("getOrCreate 创建新消费端条目", () => {
    const registry = new SharedTokenRegistry();
    const entry = registry.getOrCreate("consumer-a");

    expect(entry.ref).toBe("");
    expect(entry.lastFlush).toBe(0);
    expect(registry.size).toBe(1);
  });

  it("getOrCreate 对同一 consumerId 返回相同引用", () => {
    const registry = new SharedTokenRegistry();
    const entry1 = registry.getOrCreate("consumer-a");
    const entry2 = registry.getOrCreate("consumer-a");

    expect(entry1).toBe(entry2);
    expect(registry.size).toBe(1);
  });

  it("appendToAll 将 token 追加到所有消费端", () => {
    const registry = new SharedTokenRegistry();
    registry.getOrCreate("consumer-a");
    registry.getOrCreate("consumer-b");

    registry.appendToAll(["Hello", " ", "World"]);

    expect(registry.getContent("consumer-a")).toBe("Hello World");
    expect(registry.getContent("consumer-b")).toBe("Hello World");
  });

  it("appendToAll 多次调用累积文本", () => {
    const registry = new SharedTokenRegistry();
    registry.getOrCreate("consumer-a");

    registry.appendToAll(["Hello"]);
    registry.appendToAll([" World"]);

    expect(registry.getContent("consumer-a")).toBe("Hello World");
  });

  it("appendToAll 更新 lastFlush 时间戳", () => {
    const registry = new SharedTokenRegistry();
    const entry = registry.getOrCreate("consumer-a");

    expect(entry.lastFlush).toBe(0);

    registry.appendToAll(["token"]);

    expect(entry.lastFlush).toBeGreaterThan(0);
  });

  it("appendToAll 空数组不修改任何条目", () => {
    const registry = new SharedTokenRegistry();
    const entry = registry.getOrCreate("consumer-a");
    entry.ref = "existing";

    registry.appendToAll([]);

    expect(entry.ref).toBe("existing");
    expect(entry.lastFlush).toBe(0);
  });

  it("getContent 对不存在的消费端返回空字符串", () => {
    const registry = new SharedTokenRegistry();
    expect(registry.getContent("nonexistent")).toBe("");
  });

  it("reset 重置指定消费端的累积文本", () => {
    const registry = new SharedTokenRegistry();
    registry.getOrCreate("consumer-a");
    registry.getOrCreate("consumer-b");

    registry.appendToAll(["data"]);
    registry.reset("consumer-a");

    expect(registry.getContent("consumer-a")).toBe("");
    expect(registry.getContent("consumer-b")).toBe("data");
  });

  it("reset 对不存在的消费端无副作用", () => {
    const registry = new SharedTokenRegistry();
    registry.getOrCreate("consumer-a");

    // 不应抛错
    registry.reset("nonexistent");
    expect(registry.size).toBe(1);
  });

  it("remove 移除消费端注册", () => {
    const registry = new SharedTokenRegistry();
    registry.getOrCreate("consumer-a");
    registry.getOrCreate("consumer-b");

    registry.remove("consumer-a");

    expect(registry.size).toBe(1);
    expect(registry.getContent("consumer-a")).toBe("");
  });

  it("clear 清空所有消费端注册", () => {
    const registry = new SharedTokenRegistry();
    registry.getOrCreate("consumer-a");
    registry.getOrCreate("consumer-b");
    registry.getOrCreate("consumer-c");

    registry.clear();

    expect(registry.size).toBe(0);
  });

  it("appendToAll 只影响已注册的消费端", () => {
    const registry = new SharedTokenRegistry();
    registry.getOrCreate("consumer-a");

    registry.appendToAll(["first"]);

    // 新注册的消费端不应包含之前的 token
    registry.getOrCreate("consumer-b");

    expect(registry.getContent("consumer-a")).toBe("first");
    expect(registry.getContent("consumer-b")).toBe("");
  });
});
