/**
 * Client half of the SSH tunnel plugin: the tunnel panel in the Harness Web UI.
 *
 * No reimplementation — the tunnel manager's own Web UI (the same static page
 * the daemon serves) is shown in a frame. The workbench is same-origin with
 * this page, so it inherits authentication without a bridge. This half only
 * registers the panel and resolves the frame URL from the host half.
 */

window.__ModuleLoader__.load({
  id: "dsh-plugin-ssh-tunnel",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    /** Slot id, sidebar entry key and main-panel key. */
    const PANEL_ID = "ssh-tunnel";
    const TAB_KIND = "ssh-tunnel";
    /** The host half answers the frame URL here. */
    const CONTEXT_URL = "/ssh-tunnel/dsh/context";

    const DICTS = {
      en: {
        panel: "Tunnels",
        loading: "Opening the tunnel manager…",
        failed: "The tunnel panel could not reach the workbench",
        retry: "Retry",
        frameTitle: "SSH tunnel manager",
      },
      zh: {
        panel: "隧道",
        loading: "正在打开隧道管理器…",
        failed: "隧道面板无法连接工作台",
        retry: "重试",
        frameTitle: "SSH 隧道管理器",
      },
    };

    let boundT = null;
    function translate(key) {
      if (boundT !== null) {
        return boundT(key);
      }
      return DICTS.en[key] ?? key;
    }

    /** The panel's nav icon: a tunnel (two portals joined), drawn in host colours. */
    function TunnelIcon({ size }) {
      const edge = typeof size === "number" ? size : 18;
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: edge,
          height: edge,
          "aria-hidden": true,
          fill: "none",
          stroke: "currentColor",
          style: { display: "block" },
        },
        [
          h("ellipse", { key: "left", cx: 5, cy: 12, rx: 2.5, ry: 5, strokeWidth: 2 }),
          h("ellipse", { key: "right", cx: 19, cy: 12, rx: 2.5, ry: 5, strokeWidth: 2 }),
          h("line", { key: "top", x1: 7.5, y1: 8.5, x2: 16.5, y2: 8.5, strokeWidth: 2, strokeLinecap: "round" }),
          h("line", { key: "bottom", x1: 7.5, y1: 15.5, x2: 16.5, y2: 15.5, strokeWidth: 2, strokeLinecap: "round" }),
        ],
      );
    }

    /** The panel: a frame on the host's workbench URL. */
    function TunnelPanel() {
      const [frameUrl, setFrameUrl] = React.useState(null);
      const [failure, setFailure] = React.useState(null);
      const [attempt, setAttempt] = React.useState(0);

      React.useEffect(() => {
        let live = true;
        setFailure(null);
        fetch(CONTEXT_URL, { headers: { accept: "application/json" } })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`context request answered ${String(response.status)}`);
            }
            return response.json();
          })
          .then((payload) => {
            if (live) {
              setFrameUrl(String(payload.panelUrl));
            }
          })
          .catch((error) => {
            if (live) {
              setFailure(error instanceof Error ? error.message : String(error));
            }
          });
        return () => {
          live = false;
        };
      }, [attempt]);

      if (failure !== null) {
        return h(
          "div",
          { style: { display: "grid", placeItems: "center", height: "100%", gap: 12 } },
          h("p", { style: { margin: 0, opacity: 0.8 } }, `${translate("failed")} (${failure})`),
          h(
            "button",
            {
              type: "button",
              onClick: () => setAttempt((value) => value + 1),
              style: {
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid rgba(128,128,128,.4)",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              },
            },
            translate("retry"),
          ),
        );
      }

      if (frameUrl === null) {
        return h(
          "div",
          { style: { display: "grid", placeItems: "center", height: "100%", opacity: 0.7 } },
          h("p", { style: { margin: 0 } }, translate("loading")),
        );
      }

      return h("iframe", {
        src: frameUrl,
        title: translate("frameTitle"),
        style: { border: "none", width: "100%", height: "100%" },
      });
    }

    return {
      apply(context) {
        boundT = typeof context.t === "function" ? (key) => context.t(`ssh-tunnel:${key}`) : null;
        context.registerPanel({
          id: PANEL_ID,
          title: () => translate("panel"),
          icon: (props) => h(TunnelIcon, props),
          body: () => h(TunnelPanel, {}),
          kind: TAB_KIND,
        });
      },
    };
  },
});
