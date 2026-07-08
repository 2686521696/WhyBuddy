// antd v5 官方 React 19 兼容补丁（message/Modal 静态方法、wave 效果等
// 依赖的 ReactDOM render 适配）——必须在任何 antd 组件渲染前引入一次。
import "@ant-design/v5-patch-for-react-19";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./styles/mirofish-tokens.css";
import "./styles/mirofish-layer.css";
import { migrateLegacyStorage } from "./lib/migrate-storage";

// WhyBuddy → SlideRule rename: move legacy localStorage entries before anything reads them.
migrateLegacyStorage();

createRoot(document.getElementById("root")!).render(<App />);

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
