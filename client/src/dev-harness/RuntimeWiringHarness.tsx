/**
 * Dev-only：**真实运行时**的接线台（2026-08-08，②阶段复盘的产物）。
 *
 * ## 为什么需要它
 *
 * 复盘时发现批次 1-4 建的六个区块在真实应用里全是死壳——`AppRuntimeScreen`
 * 没接 selection / columnState / focus 这几条通道。补完之后要确认"真的活了"，
 * 但确认这件事此前**没有便宜的办法**：
 *
 * - 组件库对照台（ComponentsLibraryPage）走的是另一条渲染路径，它一直是好的，
 *   所以它证明不了运行时；
 * - 生成一个真应用要跑一轮 LLM 推演，二十多分钟且不保证产出这几个区块。
 *
 * 于是有了这个台子：**喂一份写死的五系统模型给 AppRuntimeScreen**，页面上
 * 一次摆齐表格 + 批量操作栏 + 列设置 + 标签筛选 + 搜索框，用 targets 连好线。
 * 点得动就是通了，点不动就是没通——不依赖模型、不依赖网络、每次一样。
 *
 * ## 这份模型是手写的，不是生成的
 *
 * 它只需要"结构上合法"，不需要"业务上像真的"。真实性由生成侧的门禁负责；
 * 这里要的是一个**确定的**页面，好让接线这件事可复现地被看见。
 *
 * 走 `/runtime-wiring.html`（vite dev 下可达，不进生产产物——构建入口只有
 * index.html，跟 block-gallery / wall-fixture 同一条规矩）。
 */
import React from "react";

import { AppRuntimeScreen } from "@/pages/sliderule/live-runtime/AppRuntimeScreen";
import type { FiveSystemModel } from "@/pages/sliderule/system-screens/five-system-model";

/** 订单 + 订单日志：日志分属不同订单，才验得出关联单据表真的筛了。 */
export const RUNTIME_WIRING_MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "order",
        name: "订单",
        fields: [
          { id: "name", name: "门店", type: "string" },
          { id: "amount", name: "金额", type: "number" },
          { id: "status", name: "状态", type: "enum" },
          { id: "channel", name: "渠道", type: "enum" },
          { id: "at", name: "下单日期", type: "date" },
        ],
      },
      {
        id: "orderLog",
        name: "订单日志",
        fields: [
          { id: "orderId", name: "所属订单", type: "ref" },
          // action 得是**枚举且带取值声明**：标签筛选行的每一颗标签就是它的一个
          // 取值，string 字段摊不出标签（第一版写成 string，台子上那一行是空的）。
          {
            id: "action",
            name: "操作",
            type: "enum",
            options: [
              { id: "created", label: "创建", tone: "default" },
              { id: "reviewed", label: "复核", tone: "processing" },
              { id: "shipped", label: "发货", tone: "success" },
            ],
          },
          { id: "operator", name: "操作人", type: "string" },
        ],
      },
    ],
  },
  // 角色的权限集 = roleRefs 命中的菜单 permissionRefs 的并集（见 rbac-preview）。
  // menus 留空的话这个角色一条权限都没有，订单页会被判成"不可见"，整页不上屏
  // ——第一版就是这么写的，台子起来了但停在总览页，点菜单也进不去。
  rbac: {
    roles: ["运营"],
    permissions: ["order:create", "order:read"],
    menus: [
      {
        id: "m-order",
        label: "订单管理",
        roleRefs: ["运营"],
        permissionRefs: ["order:create", "order:read"],
      },
    ],
  },
  workflow: { nodes: [], transitions: [] },
  page: {
    pages: [
      {
        id: "order_list",
        name: "订单管理",
        // **kind 必须是 monitor/dashboard，体验区块才会上屏。**
        //
        // 这是 2026-08-08 用这个台子逮到的第二件事：桌面档的 workbench/wizard 页
        // 走 `usesProWorkbench` 那条分支，整页交给内置的 ProTable 骨架，
        // `blockScaffold` 一个都不渲染（见 AppRuntimeScreen 里 businessPageGrid 与
        // 末尾那个 `OVERVIEW_KINDS.has(...) ? blockScaffold : null`）。
        //
        // 也就是说：**列表页上的体验区块在真实运行时是看不见的**。这是个产品级
        // 决定（固定骨架 vs 积木谁拥有业务页），不在这个台子的职责里改。台子先
        // 在区块真的会渲染的那一档上，把接线验通。
        kind: "monitor",
        fieldBindings: [
          "order.name",
          "order.amount",
          "order.status",
          "order.channel",
          "order.at",
        ],
        actionPermissions: ["order:create", "order:read"],
        // 五个区块 + 连线。这一页存在的唯一意义就是把接线全用上一遍。
        blocks: [
          {
            id: "b-search",
            type: "SearchBox",
            props: { title: "搜索", placeholder: "搜门店名" },
            binding: { entityRef: "orderLog", targets: ["b-table"] },
          },
          {
            id: "b-tags",
            type: "TagFilterRow",
            props: { title: "按标签筛选" },
            binding: {
              entityRef: "orderLog",
              fieldRefs: ["action"],
              targets: ["b-table"],
            },
          },
          {
            id: "b-colset",
            type: "ColumnSettingPanel",
            props: { title: "列设置" },
            binding: { entityRef: "orderLog", targets: ["b-table"] },
          },
          {
            id: "b-table",
            type: "DataTable",
            props: { title: "订单日志" },
            // **故意绑副实体**：运行时有一条"一页一个主人"的规矩，会把绑主实体
            // 的 DataTable 整个摘掉（页面本来就自带一张主实体表）。台子要验的是
            // 接线，不是那条规矩，所以让它绑 orderLog——那种表运行时会留着。
            binding: {
              entityRef: "orderLog",
              fieldRefs: ["orderId", "action", "operator"],
            },
          },
          {
            id: "b-batch",
            type: "BatchActionBar",
            props: { actions: ["批量导出", "批量关闭"] },
            binding: { entityRef: "orderLog", targets: ["b-table"] },
          },
        ],
        layout: {
          header: ["b-colset"],
          filters: ["b-search", "b-tags"],
          main: ["b-table"],
          footerBar: ["b-batch"],
        },
      },
    ],
  },
  aigc: { capabilities: [] },
  appbundle: {
    pageBindings: [],
    roleRefs: ["运营"],
    dataModelRefs: ["order", "orderLog"],
  },
} as unknown as FiveSystemModel;

export function RuntimeWiringHarness() {
  return (
    <div style={{ height: "100vh", overflow: "auto", background: "#faf9f7" }}>
      <div style={{ padding: "8px 12px", fontSize: 12, color: "#78716c" }}>
        dev-only 接线台 —— 这里点得动，才说明真实运行时把通道接上了
      </div>
      <div data-testid="runtime-wiring-stage" style={{ height: "calc(100vh - 32px)" }}>
        <AppRuntimeScreen
          model={RUNTIME_WIRING_MODEL}
          sessionId="runtime-wiring-harness"
          appTitle="接线台"
        />
      </div>
    </div>
  );
}
