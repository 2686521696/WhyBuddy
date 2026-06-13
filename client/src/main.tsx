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
