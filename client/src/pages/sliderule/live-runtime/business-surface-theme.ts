import type { CSSProperties } from "react";

export const BUSINESS_SURFACE_STYLE: CSSProperties = {
  background: "var(--ant-color-bg-container, #ffffff)",
  borderColor: "var(--ant-color-border-secondary, #f0f0f0)",
  color: "var(--ant-color-text, #262626)",
};

export const BUSINESS_MUTED_SURFACE_STYLE: CSSProperties = {
  ...BUSINESS_SURFACE_STYLE,
  background: "var(--ant-color-fill-quaternary, #fafafa)",
  color: "var(--ant-color-text-secondary, #595959)",
};

export const BUSINESS_TEXT_COLOR = "var(--ant-color-text, #262626)";
export const BUSINESS_SECONDARY_TEXT_COLOR =
  "var(--ant-color-text-secondary, #595959)";
export const BUSINESS_TERTIARY_TEXT_COLOR =
  "var(--ant-color-text-tertiary, #8c8c8c)";
