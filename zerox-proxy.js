import http from "node:http";

const PORT = Number(process.env.PORT || "8787");
const ZEROX_API_KEY = process.env.ZEROX_API_KEY?.trim();
const ZEROX_API_BASE_URL =
  process.env.ZEROX_API_BASE_URL?.trim() || "https://api.0x.org";
const ZEROX_VERSION = process.env.ZEROX_VERSION?.trim() || "v2";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN?.trim() || "*";
const ALLOW_METHODS = "GET,OPTIONS";
const ALLOW_HEADERS = "Content-Type";

if (!ZEROX_API_KEY) {
  console.error("Missing ZEROX_API_KEY.");
  process.exit(1);
}

function getCorsOrigin(requestOrigin) {
  if (ALLOW_ORIGIN === "*") {
    return "*";
  }

  const allowedOrigins = ALLOW_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] || "*";
}

function setCorsHeaders(response, requestOrigin) {
  response.setHeader("Access-Control-Allow-Credentials", "false");
  response.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  response.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);
  response.setHeader("Access-Control-Allow-Origin", getCorsOrigin(requestOrigin));
  response.setHeader("Vary", "Origin");
}

function writeJson(response, statusCode, payload, requestOrigin) {
  setCorsHeaders(response, requestOrigin);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function proxyZeroEx(requestPath, queryString) {
  const url = `${ZEROX_API_BASE_URL}${requestPath}${queryString ? `?${queryString}` : ""}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "0x-api-key": ZEROX_API_KEY,
      "0x-version": ZEROX_VERSION
    },
    method: "GET"
  });

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = {
      reason: "0x returned a non-JSON response.",
      raw: text
    };
  }

  return {
    headers: response.headers,
    ok: response.ok,
    payload,
    status: response.status
  };
}

const routes = new Map([
  ["/health", { type: "health" }],
  ["/api/price", { type: "proxy", upstreamPath: "/swap/allowance-holder/price" }],
  ["/api/quote", { type: "proxy", upstreamPath: "/swap/allowance-holder/quote" }],
  ["/api/sources", { type: "proxy", upstreamPath: "/sources" }]
]);

const server = http.createServer(async (request, response) => {
  const requestOrigin = request.headers.origin;
  const parsedUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const route = routes.get(parsedUrl.pathname);

  if (request.method === "OPTIONS") {
    setCorsHeaders(response, requestOrigin);
    response.writeHead(204);
    response.end();
    return;
  }

  if (!route) {
    writeJson(
      response,
      404,
      { error: "Not found." },
      requestOrigin
    );
    return;
  }

  if (request.method !== "GET") {
    writeJson(
      response,
      405,
      { error: "Method not allowed." },
      requestOrigin
    );
    return;
  }

  if (route.type === "health") {
    writeJson(
      response,
      200,
      {
        ok: true,
        service: "zerox-proxy",
        upstream: ZEROX_API_BASE_URL,
        version: ZEROX_VERSION
      },
      requestOrigin
    );
    return;
  }

  try {
    const result = await proxyZeroEx(route.upstreamPath, parsedUrl.searchParams.toString());
    const requestId =
      result.headers.get("x-request-id") ||
      result.headers.get("0x-request-id") ||
      result.headers.get("cf-ray");

    writeJson(
      response,
      result.status,
      requestId
        ? { ...result.payload, requestId }
        : result.payload,
      requestOrigin
    );
  } catch (error) {
    writeJson(
      response,
      502,
      {
        error: "Failed to reach 0x.",
        message: error instanceof Error ? error.message : "Unknown upstream error."
      },
      requestOrigin
    );
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`0x proxy listening on port ${PORT}`);
});
