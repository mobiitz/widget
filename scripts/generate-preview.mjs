import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const distDir = resolve(process.cwd(), "dist");
const previewHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MBTC Swap Widget Preview</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Avenir Next", "Space Grotesk", "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top, rgba(30, 89, 180, 0.35), transparent 35%),
          linear-gradient(180deg, #06101c 0%, #02070f 100%);
        color: #edf4ff;
      }

      main {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
        padding: 40px 0 64px;
      }

      .hero {
        display: grid;
        gap: 16px;
        margin-bottom: 28px;
      }

      .eyebrow {
        margin: 0;
        color: #7ab6ff;
        font-size: 0.8rem;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(2.2rem, 4vw, 4rem);
        letter-spacing: -0.05em;
        line-height: 0.95;
      }

      .copy {
        margin: 0;
        max-width: 58ch;
        color: #a6bbdb;
        font-size: 1rem;
        line-height: 1.6;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 6px;
      }

      .pill {
        border: 1px solid rgba(136, 163, 213, 0.18);
        border-radius: 999px;
        padding: 8px 12px;
        background: rgba(9, 17, 29, 0.78);
        color: #d8e6fb;
        font-size: 0.78rem;
        font-weight: 700;
      }

      .layout {
        display: grid;
        gap: 28px;
        grid-template-columns: minmax(0, 480px) minmax(0, 1fr);
        align-items: start;
      }

      .panel {
        border: 1px solid rgba(136, 163, 213, 0.16);
        border-radius: 24px;
        background: rgba(8, 17, 29, 0.74);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
        padding: 22px;
      }

      .panel h2 {
        margin: 0 0 12px;
        font-size: 1rem;
        letter-spacing: -0.03em;
      }

      .panel p,
      .panel li,
      .panel code {
        color: #b5c8e7;
        font-size: 0.92rem;
        line-height: 1.6;
      }

      .panel ul {
        margin: 0;
        padding-left: 18px;
      }

      pre {
        margin: 14px 0 0;
        overflow-x: auto;
        border-radius: 16px;
        padding: 14px;
        background: rgba(3, 8, 18, 0.92);
        border: 1px solid rgba(136, 163, 213, 0.12);
      }

      a {
        color: #7fdcff;
      }

      #preview-widget {
        min-height: 200px;
      }

      .preview-error {
        border: 1px solid rgba(228, 104, 133, 0.28);
        border-radius: 20px;
        background: rgba(98, 22, 39, 0.24);
        color: #ffd8e2;
        padding: 18px;
        font-size: 0.92rem;
        line-height: 1.6;
      }

      .preview-error strong {
        display: block;
        margin-bottom: 6px;
        color: #fff4f7;
      }

      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Live Preview</p>
        <h1>MBTC Swap Widget</h1>
        <p class="copy">
          This GitHub Pages front page loads the production <code>widget.js</code>
          bundle exactly as a third-party site would. Use it to confirm the
          latest deployed build, wallet connection flow, and 0x quote
          behavior before embedding elsewhere.
        </p>
        <div class="meta">
          <span class="pill">Preview URL: /widget/</span>
          <span class="pill">Bundle URL: /widget/widget.js</span>
        </div>
      </section>

      <section class="layout">
        <div id="preview-widget"></div>

        <aside class="panel">
          <h2>Embed Snippet</h2>
          <p>Use this exact embed on Squarespace or any other site:</p>
          <pre><code>&lt;div id="my-swap-widget"&gt;&lt;/div&gt;
&lt;script src="https://mobiitz.github.io/widget/widget.js"&gt;&lt;/script&gt;
&lt;script&gt;
  BungeeWidget.init({ targetId: "my-swap-widget" });
&lt;/script&gt;</code></pre>
          <h2 style="margin-top: 22px;">Notes</h2>
          <ul>
            <li>This page uses the same deployed artifact your external embeds use.</li>
            <li>If quotes fail here, check your 0x API key and the live GitHub Pages build variables.</li>
            <li>If the widget updates, refresh after the GitHub Pages deployment completes.</li>
          </ul>
        </aside>
      </section>
    </main>

    <script src="./widget.js"></script>
    <script>
      (function () {
        const target = document.getElementById("preview-widget");

        function showError(message) {
          target.innerHTML =
            '<div class="preview-error">' +
            '<strong>Widget preview failed to mount.</strong>' +
            message +
            "</div>";
        }

        try {
          if (!window.BungeeWidget || typeof window.BungeeWidget.init !== "function") {
            showError("The deployed bundle did not expose window.BungeeWidget.init.");
            return;
          }

          window.BungeeWidget.init({ targetId: "preview-widget" });

          window.setTimeout(function () {
            const mounted =
              target &&
              target.shadowRoot &&
              target.shadowRoot.childNodes &&
              target.shadowRoot.childNodes.length > 0;

            if (!mounted) {
              showError(
                "The bundle loaded, but no widget markup was mounted. Open the browser console for the runtime error."
              );
            }
          }, 250);
        } catch (error) {
          showError(error instanceof Error ? error.message : String(error));
        }
      })();
    </script>
  </body>
</html>
`;

await mkdir(distDir, { recursive: true });
await writeFile(resolve(distDir, "index.html"), previewHtml, "utf8");
