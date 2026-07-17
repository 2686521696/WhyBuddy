// antd v5 官方 React 19 兼容补丁（message/Modal 静态方法、wave 效果等
// 依赖的 ReactDOM render 适配）——必须在任何 antd 组件渲染前引入一次。
import "@ant-design/v5-patch-for-react-19";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./styles/mirofish-tokens.css";
import "./styles/mirofish-layer.css";
import { migrateLegacyStorage } from "./lib/migrate-storage";
import { initUserPrefs } from "./pages/sliderule/user-prefs";

// WhyBuddy → SlideRule rename: move legacy localStorage entries before anything reads them.
migrateLegacyStorage();
// 偏好落地（减少动效 root class 等）——首帧前生效，避免动画闪现一下再静止
initUserPrefs();

createRoot(document.getElementById("root")!).render(<App />);

// E33.5 启动占位页交棒：占位页只负责 React 挂载前的空窗（纯 CSS 转圈，
// 零字体依赖不变形）——挂载完成立即摘，水合期由推演页的 antd Spin
// fullscreen 接管。html 里另有 45s 自毁兜底。
(
  window as unknown as { __slideruleDismissBootSplash?: () => void }
).__slideruleDismissBootSplash?.();

// Analytics bootstrap (moved from index.html for cleaner Vite HTML processing during `build:pages` / GITHUB_PAGES builds;
// avoids internal html-proxy resolution errors with multiple inline module scripts + custom transforms).
const analyticsEndpoint = (import.meta as any).env?.VITE_ANALYTICS_ENDPOINT;
const analyticsWebsiteId = (import.meta as any).env?.VITE_ANALYTICS_WEBSITE_ID;
if (analyticsEndpoint && analyticsWebsiteId) {
  const script = document.createElement("script");
  script.defer = true;
  script.src = `${String(analyticsEndpoint).replace(/\/$/, "")}/umami`;
  script.dataset.websiteId = analyticsWebsiteId;
  document.body.appendChild(script);
}
