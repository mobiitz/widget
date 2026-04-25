export type QuoteParams = {
  userAddress: string;
  receiverAddress: string;
  originChainId: number;
  destinationChainId: number;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  enableManual?: boolean;
  feeBps?: number | string;
  feeTakerAddress?: string;
  slippage?: number;
};

export type ApprovalData = {
  amount: string;
  spenderAddress: string;
  tokenAddress: string;
  userAddress?: string;
};

export type QuoteRoute = {
  quoteId: string;
  toAmount?: string;
  outputAmount?: string;
  receivedAmount?: string;
  serviceTime?: number;
  maxServiceTime?: number;
  totalGasFeesInUsd?: number;
  inputValueInUsd?: number;
  outputValueInUsd?: number;
  receivedValueInUsd?: number;
  usedBridgeNames?: string[];
  approvalData?: ApprovalData | null;
  integratorFee?: {
    amount?: string;
    asset?: {
      decimals?: number;
      name?: string;
      symbol?: string;
    };
  };
  userTxs?: Array<{
    userTxType?: string;
    steps?: Array<{
      protocolName?: string;
      stepType?: string;
      tool?: string;
    }>;
  }>;
  [key: string]: unknown;
};

export type QuoteResponse = {
  autoRoute?: QuoteRoute;
  manualRoutes?: QuoteRoute[];
  [key: string]: unknown;
};

export type BuiltTransaction = {
  to: string;
  data?: string;
  value?: string;
  gas?: string;
  gasLimit?: string;
};

export type BuildTxResponse = {
  approvalData?: ApprovalData | null;
  requestHash?: string;
  txData: BuiltTransaction;
};

export type StatusResponse = {
  bungeeStatusCode?: number;
  destinationData?: {
    txHash?: string;
  };
  refund?: {
    txHash?: string;
  };
  [key: string]: unknown;
};

type BungeeEnvelope<T> = {
  success: boolean;
  statusCode?: number;
  message?: string;
  error?: {
    message?: string;
  };
  result: T;
};

type QueryValue = string | number | boolean | null | undefined;

const apiKey = import.meta.env.VITE_BUNGEE_API_KEY?.trim();
const affiliate = import.meta.env.VITE_BUNGEE_AFFILIATE?.trim();
const feeTakerAddress = import.meta.env.VITE_BUNGEE_FEE_TAKER_ADDRESS?.trim();

const configuredBaseUrl = import.meta.env.VITE_BUNGEE_API_BASE_URL?.trim();

export const BUNGEE_API_BASE_URL =
  configuredBaseUrl ||
  (apiKey
    ? "https://dedicated-backend.bungee.exchange"
    : "https://public-backend.bungee.exchange");

export const BUNGEE_ENVIRONMENT_LABEL = apiKey
  ? "Dedicated Backend"
  : configuredBaseUrl
    ? "Frontend / Direct"
    : "Public Sandbox";

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

const feeBps = normalizeFeeBps(import.meta.env.VITE_BUNGEE_FEE_BPS);

export const BUNGEE_FEE_CONFIGURATION =
  feeTakerAddress && feeBps
    ? {
        feeBps,
        feeTakerAddress
      }
    : null;

function buildHeaders() {
  const headers: HeadersInit = {
    Accept: "application/json"
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  if (affiliate) {
    headers["affiliate"] = affiliate;
  }

  return headers;
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
  const url = `${BUNGEE_API_BASE_URL}${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: buildHeaders(),
    method: "GET"
  });

  const serverReqId = response.headers.get("server-req-id");
  let payload: BungeeEnvelope<T>;

  try {
    payload = (await response.json()) as BungeeEnvelope<T>;
  } catch {
    throw new Error(
      `Bungee API returned an unreadable response. server-req-id: ${serverReqId ?? "n/a"}`
    );
  }

  if (!response.ok || !payload.success) {
    const message =
      payload.message ||
      payload.error?.message ||
      `Request failed with status ${response.status}`;

    throw new Error(
      `${message}. server-req-id: ${serverReqId ?? "n/a"}`
    );
  }

  return {
    result: payload.result,
    serverReqId
  };
}

export async function getQuote(params: QuoteParams) {
  const response = await request<QuoteResponse>("/api/v1/bungee/quote", {
    ...params,
    enableManual: params.enableManual ?? true,
    feeBps: params.feeBps ?? BUNGEE_FEE_CONFIGURATION?.feeBps,
    feeTakerAddress:
      params.feeTakerAddress ?? BUNGEE_FEE_CONFIGURATION?.feeTakerAddress,
    slippage: params.slippage ?? 1
  });

  const routes =
    response.result.manualRoutes ??
    (response.result.autoRoute ? [response.result.autoRoute] : []);

  if (!routes.length) {
    throw new Error(
      `No routes were returned by Bungee. server-req-id: ${response.serverReqId ?? "n/a"}`
    );
  }

  return {
    bestRoute: routes[0],
    routes,
    serverReqId: response.serverReqId,
    raw: response.result
  };
}

export async function buildTx(quoteId: string) {
  const response = await request<BuildTxResponse>("/api/v1/bungee/build-tx", {
    quoteId
  });

  return {
    ...response.result,
    serverReqId: response.serverReqId
  };
}

export async function checkStatus(txHash: string) {
  const response = await request<StatusResponse>("/api/v1/bungee/status", {
    requestHash: txHash
  });

  return {
    ...response.result,
    serverReqId: response.serverReqId
  };
}
