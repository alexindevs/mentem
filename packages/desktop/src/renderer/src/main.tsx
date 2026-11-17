import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Mini } from "./components/Mini";
import { Mark } from "./components/Mark";
import "./styles.css";

/** The logo alone on a transparent window, so it can be saved as the app and tray icons. */
function IconStage({ kind }: { kind: "icon" | "tray" | "tray-dark" }) {
  document.documentElement.classList.add("mini-window");
  const dark = kind === "tray-dark";
  return (
    <div style={{ display: "grid", width: "100vw", height: "100vh", placeItems: "center", ...(dark ? ({ "--text": "#f5f5f0" } as React.CSSProperties) : {}) }}>
      <Mark size={kind === "icon" ? 480 : 60} variant={kind === "icon" ? "full" : "small"} />
    </div>
  );
}

const hash = window.location.hash;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {hash === "#mini" ? <Mini /> : hash === "#icon" || hash === "#tray" || hash === "#tray-dark" ? <IconStage kind={hash.slice(1) as "icon" | "tray" | "tray-dark"} /> : <App />}
  </StrictMode>,
);
