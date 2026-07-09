/**
 * component-registry — 页面设计器二期：核心组件注册表。
 *
 * 对标 zip web-designer 的 ComponentRegistry（definitions/*.ts），SlideRule 取舍：
 *   - 核心 17 个组件覆盖截图范式（布局/基础/输入/数据四类），
 *     长尾组件（签章、二维码等）留三期；
 *   - 数据类组件（数据表格/数据表单/图表/审批进度）的绑定属性
 *     全部是数据感知 PropertyType——属性面板只出五系统模型里
 *     真实存在的实体/字段/页面，结构上防悬挂；
 *   - 事件动作先做两个真的：打开页面（openPage）/ 发起审批（startApproval），
 *     挂在按钮与链接块的 actionKind 上（不做空壳事件系统）。
 */

import type { ComponentCategory, ComponentDefinition } from "./component-schema";

export const CATEGORY_ORDER: Array<{ key: ComponentCategory; label: string }> = [
  { key: "layout", label: "布局" },
  { key: "basic", label: "基础" },
  { key: "input", label: "输入" },
  { key: "data", label: "数据" },
];

/** 按钮/链接块共用的事件动作属性（二期先做两个真动作） */
const ACTION_PROPS_SCHEMA = [
  {
    key: "actionKind",
    label: "点击动作",
    type: "select" as const,
    defaultValue: "none",
    options: [
      { value: "none", label: "无" },
      { value: "openPage", label: "打开页面" },
      { value: "startApproval", label: "发起审批" },
    ],
  },
  {
    key: "actionPageId",
    label: "目标页面",
    type: "pageSelect" as const,
    showWhen: { actionKind: "openPage" },
  },
];

const DEFINITIONS: ComponentDefinition[] = [
  // -------------------------------------------------------------- 布局
  {
    type: "container",
    name: "容器",
    category: "layout",
    icon: "BorderOutlined",
    description: "纵向排列子组件的基础容器（页面根即容器）",
    isContainer: true,
    defaultProps: { gap: 12, padding: 0, background: "none" },
    propsSchema: [
      { key: "gap", label: "子项间距", type: "number", defaultValue: 12, min: 0, max: 48 },
      { key: "padding", label: "内边距", type: "number", defaultValue: 0, min: 0, max: 48 },
      {
        key: "background",
        label: "背景",
        type: "select",
        defaultValue: "none",
        options: [
          { value: "none", label: "透明" },
          { value: "white", label: "白卡" },
          { value: "gray", label: "浅灰" },
        ],
      },
    ],
  },
  {
    type: "columns",
    name: "分栏",
    category: "layout",
    icon: "InsertRowAboveOutlined",
    description: "横向等分排列子组件（每个直接子组件占一栏）",
    isContainer: true,
    defaultProps: { gap: 12 },
    propsSchema: [{ key: "gap", label: "栏间距", type: "number", defaultValue: 12, min: 0, max: 48 }],
  },
  {
    type: "group",
    name: "分组",
    category: "layout",
    icon: "AppstoreOutlined",
    description: "带标题的分组卡片（antd Card）",
    isContainer: true,
    defaultProps: { title: "分组", bordered: true },
    propsSchema: [
      { key: "title", label: "分组标题", type: "string", defaultValue: "分组" },
      { key: "bordered", label: "显示边框", type: "boolean", defaultValue: true },
    ],
  },
  {
    type: "tabs",
    name: "选项卡",
    category: "layout",
    icon: "FolderOutlined",
    description: "每个直接子容器是一个页签",
    isContainer: true,
    allowedChildren: ["container"],
    defaultProps: { titles: "页签一,页签二" },
    propsSchema: [
      {
        key: "titles",
        label: "页签标题（逗号分隔）",
        type: "string",
        defaultValue: "页签一,页签二",
        tooltip: "第 N 个标题对应第 N 个子容器",
      },
    ],
  },

  // -------------------------------------------------------------- 基础
  {
    type: "text",
    name: "文本",
    category: "basic",
    icon: "FontSizeOutlined",
    isContainer: false,
    defaultProps: { content: "文本内容", variant: "body" },
    propsSchema: [
      { key: "content", label: "内容", type: "text", defaultValue: "文本内容" },
      {
        key: "variant",
        label: "样式",
        type: "select",
        defaultValue: "body",
        options: [
          { value: "title", label: "标题" },
          { value: "subtitle", label: "副标题" },
          { value: "body", label: "正文" },
          { value: "caption", label: "说明文字" },
        ],
      },
    ],
  },
  {
    type: "image",
    name: "图片",
    category: "basic",
    icon: "PictureOutlined",
    isContainer: false,
    defaultProps: { src: "", alt: "图片", height: 160 },
    propsSchema: [
      { key: "src", label: "图片地址", type: "string", placeholder: "https://…（留空显示占位）" },
      { key: "alt", label: "替代文本", type: "string", defaultValue: "图片" },
      { key: "height", label: "高度(px)", type: "number", defaultValue: 160, min: 40, max: 640 },
    ],
  },
  {
    type: "button",
    name: "按钮",
    category: "basic",
    icon: "PlayCircleOutlined",
    isContainer: false,
    defaultProps: { label: "按钮", buttonType: "primary", actionKind: "none" },
    propsSchema: [
      { key: "label", label: "文本", type: "string", defaultValue: "按钮" },
      {
        key: "buttonType",
        label: "类型",
        type: "select",
        defaultValue: "primary",
        options: [
          { value: "primary", label: "主要" },
          { value: "default", label: "默认" },
          { value: "dashed", label: "虚线" },
          { value: "link", label: "链接" },
        ],
      },
      ...ACTION_PROPS_SCHEMA,
    ],
  },
  {
    type: "link-block",
    name: "链接块",
    category: "basic",
    icon: "LinkOutlined",
    description: "整块可点的导航卡（截图范式中的链接块）",
    isContainer: false,
    defaultProps: { title: "链接块", desc: "点击跳转", actionKind: "openPage" },
    propsSchema: [
      { key: "title", label: "标题", type: "string", defaultValue: "链接块" },
      { key: "desc", label: "描述", type: "string", defaultValue: "点击跳转" },
      ...ACTION_PROPS_SCHEMA,
    ],
  },
  {
    type: "divider",
    name: "分割线",
    category: "basic",
    icon: "LineOutlined",
    isContainer: false,
    defaultProps: { label: "" },
    propsSchema: [{ key: "label", label: "分割线文字", type: "string", placeholder: "留空为纯线" }],
  },

  // -------------------------------------------------------------- 输入
  {
    type: "input",
    name: "单行输入",
    category: "input",
    icon: "EditOutlined",
    isContainer: false,
    defaultProps: { label: "输入项", placeholder: "请输入" },
    propsSchema: [
      { key: "label", label: "标签", type: "string", defaultValue: "输入项" },
      { key: "placeholder", label: "占位提示", type: "string", defaultValue: "请输入" },
    ],
  },
  {
    type: "textarea",
    name: "多行输入",
    category: "input",
    icon: "AlignLeftOutlined",
    isContainer: false,
    defaultProps: { label: "多行输入", placeholder: "请输入", rows: 3 },
    propsSchema: [
      { key: "label", label: "标签", type: "string", defaultValue: "多行输入" },
      { key: "placeholder", label: "占位提示", type: "string", defaultValue: "请输入" },
      { key: "rows", label: "行数", type: "number", defaultValue: 3, min: 2, max: 10 },
    ],
  },
  {
    type: "select",
    name: "下拉选择",
    category: "input",
    icon: "DownSquareOutlined",
    isContainer: false,
    defaultProps: { label: "下拉选择", options: "选项一,选项二" },
    propsSchema: [
      { key: "label", label: "标签", type: "string", defaultValue: "下拉选择" },
      { key: "options", label: "选项（逗号分隔）", type: "string", defaultValue: "选项一,选项二" },
    ],
  },
  {
    type: "date-picker",
    name: "日期选择",
    category: "input",
    icon: "CalendarOutlined",
    isContainer: false,
    defaultProps: { label: "日期" },
    propsSchema: [{ key: "label", label: "标签", type: "string", defaultValue: "日期" }],
  },

  // -------------------------------------------------------------- 数据（锚五系统模型）
  {
    type: "data-table",
    name: "数据表格",
    category: "data",
    icon: "TableOutlined",
    description: "绑定实体的行数据表（与运行应用同源）",
    isContainer: false,
    defaultProps: { entityId: "", columnFieldIds: [], pageSize: 5 },
    propsSchema: [
      { key: "entityId", label: "绑定实体", type: "entitySelect" },
      {
        key: "columnFieldIds",
        label: "表格列",
        type: "fieldIdMultiSelect",
        entityKey: "entityId",
      },
      { key: "pageSize", label: "每页行数", type: "number", defaultValue: 5, min: 3, max: 20 },
    ],
  },
  {
    type: "data-form",
    name: "数据表单",
    category: "data",
    icon: "FormOutlined",
    description: "绑定实体的录入表单（字段类型驱动控件）",
    isContainer: false,
    defaultProps: { entityId: "", formFieldIds: [], submitLabel: "提交" },
    propsSchema: [
      { key: "entityId", label: "绑定实体", type: "entitySelect" },
      { key: "formFieldIds", label: "表单字段", type: "fieldIdMultiSelect", entityKey: "entityId" },
      { key: "submitLabel", label: "提交按钮文案", type: "string", defaultValue: "提交" },
    ],
  },
  {
    type: "chart",
    name: "图表",
    category: "data",
    icon: "BarChartOutlined",
    description: "库无关图表声明（dimension/metric），渲染走 ECharts",
    isContainer: false,
    defaultProps: { title: "图表", chartType: "bar", dimension: "", metric: "count" },
    propsSchema: [
      { key: "title", label: "图表标题", type: "string", defaultValue: "图表" },
      {
        key: "chartType",
        label: "图表类型",
        type: "select",
        defaultValue: "bar",
        options: [
          { value: "bar", label: "柱状图" },
          { value: "line", label: "折线图" },
          { value: "pie", label: "饼图" },
        ],
      },
      { key: "dimension", label: "维度（分组字段）", type: "fieldRefSelect" },
      { key: "metric", label: "指标", type: "metricSelect", defaultValue: "count" },
    ],
  },
  {
    type: "approval-progress",
    name: "审批进度",
    category: "data",
    icon: "NodeIndexOutlined",
    description: "主流程节点进度条（绑定 workflow 段）",
    isContainer: false,
    defaultProps: { title: "审批进度" },
    propsSchema: [{ key: "title", label: "标题", type: "string", defaultValue: "审批进度" }],
  },
];

const DEF_BY_TYPE = new Map(DEFINITIONS.map((d) => [d.type, d]));

export function getComponentDefinition(type: string): ComponentDefinition | undefined {
  return DEF_BY_TYPE.get(type);
}

export function listComponentDefinitions(): ComponentDefinition[] {
  return DEFINITIONS;
}

/** 组件面板分组视图：按 CATEGORY_ORDER 输出 { 分类, 组件定义[] } */
export function listComponentsByCategory(): Array<{
  key: ComponentCategory;
  label: string;
  items: ComponentDefinition[];
}> {
  return CATEGORY_ORDER.map(({ key, label }) => ({
    key,
    label,
    items: DEFINITIONS.filter((d) => d.category === key),
  }));
}
