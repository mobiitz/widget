export type QuoteParams = {
  buyToken: string;
  chainId: number;
  sellAmount: string;
  sellToken: string;
  swapFeeBps?: number | string;
  swapFeeRecipient?: string;
  swapFeeToken?: string;
  taker: string;
};

export type AllowanceIssue = {
  actual?: string;
  spender?: string;
};

export type ZeroExFee = {
  amount?: string;
  token?: string;
  type?: string;
};

export type RouteFill = {
  from: string;
  proportionBps: string;
  source: string;
  to: string;
};

export type ZeroExQuote = {
  allowanceTarget?: string;
  blockNumber?: string;
  buyAmount: string;
  buyToken: string;
  fees?: {
    gasFee?: ZeroExFee | null;
    integratorFee?: ZeroExFee | null;
    zeroExFee?: ZeroExFee | null;
  };
  gas?: string;
  gasPrice?: string;
  issues?: {
    allowance?: AllowanceIssue | null;
    balance?: {
      actual?: string;
      expected?: string;
      token?: string;
    } | null;
    invalidSourcesPassed?: string[];
    simulationIncomplete?: boolean;
  };
  liquidityAvailable?: boolean;
  minBuyAmount?: string;
  route?: {
    fills?: RouteFill[];
  };
  sellAmount?: string;
  sellToken?: string;
  tokenMetadata?: {
    buyToken?: {
      buyTaxBps?: string;
      sellTaxBps?: string;
    };
    sellToken?: {
      buyTaxBps?: string;
      sellTaxBps?: string;
    };
  };
  totalNetworkFee?: string;
  transaction?: {
    data?: string;
    gas?: string;
    gasPrice?: string;
    to: string;
    value?: string;
  };
  zid?: string;
};

type QueryValue = string | number | boolean | null | undefined;

const apiKey = import.meta.env.VITE_ZEROX_API_KEY?.trim();
const proxyUrl = import.meta.env.VITE_ZEROX_PROXY_URL?.trim();
const directBaseUrl =
  import.meta.env.VITE_ZEROX_API_BASE_URL?.trim() || "https://api.0x.org";
const baseUrl = (proxyUrl || directBaseUrl).replace(/\/$/, "");
const feeRecipient = import.meta.env.VITE_ZEROX_FEE_RECIPIENT?.trim();
const feeToken = import.meta.env.VITE_ZEROX_FEE_TOKEN?.trim();
const isProxyMode = Boolean(proxyUrl);

export const ZEROX_ENVIRONMENT_LABEL = isProxyMode ? "0x via Proxy" : "0x API";

function normalizeFeeBps(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  const parsedValue = Number(trimmedValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return undefined;
  }

  return Math.trunc(parsedValue).toString();
}

const feeBps = normalizeFeeBps(import.meta.env.VITE_ZEROX_FEE_BPS);

export const ZEROX_FEE_CONFIGURATION =
  feeRecipient && feeBps
    ? {
        feeBps,
        feeRecipient,
        feeToken
      }
    : null;

function buildHeaders(): Record<string, string> {
  if (isProxyMode) {
    return {
      Accept: "application/json"
    };
  }

  if (!apiKey) {
    throw new Error("0x API key is missing. Set VITE_ZEROX_API_KEY before building.");
  }

  return {
    Accept: "application/json",
    "0x-api-key": apiKey,
    "0x-version": "v2"
  };
}

function buildQuery(params: Record<string, QueryValue>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    query.set(key, String(value));
  }

  return query.toString();
}

async function request<T>(path: string, params: Record<string, QueryValue>) {
  const query = buildQuery(params);
  const response = await fetch(`${baseUrl}${path}?${query}`, {
    headers: buildHeaders(),
    method: "GET"
  });

  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("0x-request-id") ??
    response.headers.get("cf-ray");

  const responseText = await response.text();
  let payload: T | { reason?: string; validationErrors?: Array<{ reason?: string }> };

  try {
    payload = JSON.parse(responseText) as T;
  } catch {
    throw new Error(
      `0x API returned an unreadable response. request-id: ${requestId ?? "n/a"}`
    );
  }

  if (!response.ok) {
    const typedPayload = payload as {
      reason?: string;
      validationErrors?: Array<{ reason?: string }>;
    };
    const message =
      typedPayload.reason ||
      typedPayload.validationErrors?.[0]?.reason ||
      `Request failed with status ${response.status}`;

    throw new Error(`${message}. request-id: ${requestId ?? "n/a"}`);
  }

  return {
    requestId,
    result: payload as T
  };
}

export async function getQuote(params: QuoteParams) {
  const response = await request<ZeroExQuote>(
    isProxyMode ? "/api/quote" : "/swap/allowance-holder/quote",
    {
    ...params,
    swapFeeBps: params.swapFeeBps ?? ZEROX_FEE_CONFIGURATION?.feeBps,
    swapFeeRecipient:
      params.swapFeeRecipient ?? ZEROX_FEE_CONFIGURATION?.feeRecipient,
    swapFeeToken:
      params.swapFeeToken ??
      ZEROX_FEE_CONFIGURATION?.feeToken ??
      params.sellToken
    }
  );

  if (!response.result.liquidityAvailable) {
    throw new Error(
      `0x returned no available liquidity for this pair. request-id: ${response.requestId ?? "n/a"}`
    );
  }

  if (!response.result.transaction?.to) {
    throw new Error(
      `0x quote did not include executable transaction data. request-id: ${response.requestId ?? "n/a"}`
    );
  }

  return {
    quote: response.result,
    requestId: response.requestId ?? null
  };
}
