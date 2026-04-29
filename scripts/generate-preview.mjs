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
        background: linear-gradient(180deg, #06101c 0%, #02070f 100%);
        color: #edf4ff;
      }

      main {
        width: min(520px, calc(100% - 24px));
        margin: 0 auto;
        padding: 24px 0;
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
    </style>
  </head>
  <body>
    <main>
      <div id="preview-widget"></div>
    </main>

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

        let capturedRuntimeError = null;

        window.addEventListener("error", function (event) {
          capturedRuntimeError =
            event && event.error && event.error.stack
              ? event.error.stack
              : event && event.message
                ? event.message
                : "Unknown script error.";
        });

        window.addEventListener("unhandledrejection", function (event) {
          const reason = event && event.reason;
          capturedRuntimeError =
            reason && reason.stack
              ? reason.stack
              : reason instanceof Error
                ? reason.message
                : String(reason);
        });

        const script = document.createElement("script");
        script.src = "./widget.js";

        script.onload = function () {
          try {
            if (!window.BungeeWidget || typeof window.BungeeWidget.init !== "function") {
              showError(
                capturedRuntimeError
                  ? "Runtime error while executing widget.js:<br><br><code>" +
                    String(capturedRuntimeError).replace(/</g, "&lt;") +
                    "</code>"
                  : "The deployed bundle loaded, but it did not expose window.BungeeWidget.init."
              );
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
        };

        script.onerror = function () {
          showError("The preview page could not load ./widget.js.");
        };

        document.body.appendChild(script);
      })();
    </script>
  </body>
</html>
`;

await mkdir(distDir, { recursive: true });
await writeFile(resolve(distDir, "index.html"), previewHtml, "utf8");
