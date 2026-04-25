# Bungee Widget

Embeddable React swap widget bundled as a single IIFE file for easy injection into any website, including Squarespace.

## Stack

- React
- Vite
- TypeScript
- viem

The production build outputs a single script file at `dist/widget.js` and exposes:

```js
window.BungeeWidget.init({ targetId: "my-swap-widget" });
```

## Local development

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and add your Bungee credentials if you have them.

3. Start the dev server:

```bash
npm run dev
```

4. Create the production bundle:

```bash
npm run build
```

## Environment variables

```bash
VITE_BUNGEE_API_KEY=your-bungee-api-key
VITE_BUNGEE_API_BASE_URL=
VITE_BUNGEE_AFFILIATE=
VITE_BUNGEE_FEE_BPS=
VITE_BUNGEE_FEE_TAKER_ADDRESS=
```

- If `VITE_BUNGEE_API_KEY` is set, the widget defaults to Bungee's dedicated backend.
- If no API key is set, the widget falls back to the public sandbox backend.
- `VITE_BUNGEE_API_BASE_URL` can override the backend URL if Bungee provisions a whitelisted frontend endpoint for your integration.
- `VITE_BUNGEE_AFFILIATE` is optional and is sent as the `affiliate` header for integration tracking.
- `VITE_BUNGEE_FEE_BPS` and `VITE_BUNGEE_FEE_TAKER_ADDRESS` are optional. If both are set, the widget includes them on quote requests so Bungee can apply your integrator fee configuration.

## Build output

After running `npm run build`, the widget bundle is available at:

```txt
dist/widget.js
```

## GitHub Pages setup

1. Push this repository to GitHub.
2. Open `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. Push to `main`.

This repo already includes [.github/workflows/deploy.yml](./.github/workflows/deploy.yml), which builds the widget and deploys the `dist` directory to GitHub Pages on every push to `main`.

Because the repository name is `widget`, the hosted script URL will be:

```html
https://YOUR_GITHUB_USERNAME.github.io/widget/widget.js
```

## Squarespace embed code

```html
<div id="my-swap-widget"></div>
<script src="https://YOUR_GITHUB_USERNAME.github.io/widget/widget.js"></script>
<script>
  BungeeWidget.init({ targetId: "my-swap-widget" });
</script>
```

## Embedding on any site

```html
<div id="my-swap-widget"></div>
<script src="https://yourdomain/widget.js"></script>
<script>
  BungeeWidget.init({ targetId: "my-swap-widget" });
</script>
```

## Notes

- The widget mounts inside a shadow root to avoid CSS leaking into the host page.
- The widget currently supports MetaMask, Coinbase Wallet, and Uniswap Extension as injected desktop wallets.
- The quote flow uses Bungee quote, build-tx, and status endpoints.
- If `VITE_BUNGEE_FEE_BPS` and `VITE_BUNGEE_FEE_TAKER_ADDRESS` are configured, the widget requests Bungee quotes with your integrator fee parameters.
- Before production use, restrict and whitelist your Bungee integration appropriately or route API calls through your backend. Do not rely on a publicly exposed frontend API key without additional controls.
