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

// E33.2 启动占位页早摘（非推演路由）：占位页画的是推演工作台骨架——帮助
// 中心/技能库等页面没人负责摘它。推演页挂载即认领所有权（水合完成才摘，
// 整个加载期只有这一层）；600ms 后无人认领 = 当前不是推演页，立即摘。
// html 里另有 20s 自毁兜底。推演页是静态引入，挂载在首帧内，600ms 富余。
window.setTimeout(() => {
  const w = window as unknown as {
    __slideruleBootSplashOwned?: boolean;
    __slideruleDismissBootSplash?: () => void;
  };
  if (!w.__slideruleBootSplashOwned) w.__slideruleDismissBootSplash?.();
}, 600);

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
