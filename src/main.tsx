import { createRoot, type Root } from "react-dom/client";
import styles from "./styles.css?inline";
import { SwapWidget } from "./widget/SwapWidget";

type InitOptions = {
  targetId: string;
};

type MountedWidget = {
  host: HTMLDivElement;
  root: Root;
  shadowRoot: ShadowRoot;
};

type BungeeWidgetApi = {
  destroy: (targetId: string) => void;
  init: (options: InitOptions) => void;
};

declare global {
  interface Window {
    BungeeWidget: BungeeWidgetApi;
  }
}

const mounts = new Map<string, MountedWidget>();

function mountWidget(targetId: string) {
  const target = document.getElementById(targetId);

  if (!target) {
    throw new Error(`BungeeWidget target "${targetId}" was not found.`);
  }

  const existingMount = mounts.get(targetId);
  if (existingMount) {
    existingMount.root.unmount();
    existingMount.shadowRoot.innerHTML = "";
    mounts.delete(targetId);
  }

  const shadowRoot = target.shadowRoot ?? target.attachShadow({ mode: "open" });
  const styleTag = document.createElement("style");
  const host = document.createElement("div");

  styleTag.textContent = styles;
  host.className = "bw-host";
  shadowRoot.append(styleTag, host);

  const root = createRoot(host);
  root.render(<SwapWidget />);

  mounts.set(targetId, { host, root, shadowRoot });
}

function destroyWidget(targetId: string) {
  const mountedWidget = mounts.get(targetId);

  if (!mountedWidget) {
    return;
  }

  mountedWidget.root.unmount();
  mountedWidget.shadowRoot.innerHTML = "";
  mounts.delete(targetId);
}

window.BungeeWidget = {
  init: ({ targetId }) => {
    mountWidget(targetId);
  },
  destroy: (targetId) => {
    destroyWidget(targetId);
  }
};

if (import.meta.env.DEV) {
  window.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("app")) {
      window.BungeeWidget.init({ targetId: "app" });
    }
  });
}
