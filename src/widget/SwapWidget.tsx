import { startTransition, useEffect, useId, useState } from "react";
import type { Address, Hex } from "viem";
import {
  encodeFunctionData,
  formatUnits,
  parseAbi,
  parseUnits
} from "viem";
import {
  BUNGEE_ENVIRONMENT_LABEL,
  buildTx,
  checkStatus,
  getQuote,
  type ApprovalData,
  type QuoteRoute,
  type StatusResponse
} from "../services/bungee";
import {
  NATIVE_TOKEN_ADDRESS,
  SUPPORTED_CHAINS,
  findSupportedChain,
  useWallet
} from "../hooks/useWallet";

type TokenOption = {
  address: string;
  decimals: number;
  name: string;
  symbol: string;
};

type QuoteState = {
  inputAmountBaseUnits: string;
  route: QuoteRoute;
  serverReqId: string | null;
};

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
]);

const TOKENS_BY_CHAIN: Record<number, TokenOption[]> = {
  1: [
    {
      address: NATIVE_TOKEN_ADDRESS,
      decimals: 18,
      name: "Ether",
      symbol: "ETH"
    },
    {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      decimals: 6,
      name: "USD Coin",
      symbol: "USDC"
    },
    {
      address: "0x3898257dD2Cd6d2A3b6e3435f73568A725262b9B",
      decimals: 18,
      name: "MAGA Bitcoin",
      symbol: "MBTC"
    }
  ],
  10: [
    {
      address: NATIVE_TOKEN_ADDRESS,
      decimals: 18,
      name: "Ether",
      symbol: "ETH"
    },
    {
      address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      decimals: 6,
      name: "USD Coin",
      symbol: "USDC"
    }
  ],
  56: [
    {
      address: NATIVE_TOKEN_ADDRESS,
      decimals: 18,
      name: "BNB",
      symbol: "BNB"
    },
    {
      address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      decimals: 18,
      name: "USD Coin",
      symbol: "USDC"
    }
  ],
  137: [
    {
      address: NATIVE_TOKEN_ADDRESS,
      decimals: 18,
      name: "POL",
      symbol: "POL"
    },
    {
      address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      decimals: 6,
      name: "USD Coin",
      symbol: "USDC"
    }
  ],
  8453: [
    {
      address: NATIVE_TOKEN_ADDRESS,
      decimals: 18,
      name: "Ether",
      symbol: "ETH"
    },
    {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      name: "USD Coin",
      symbol: "USDC"
    }
  ],
  42161: [
    {
      address: NATIVE_TOKEN_ADDRESS,
      decimals: 18,
      name: "Ether",
      symbol: "ETH"
    },
    {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: 6,
      name: "USD Coin",
      symbol: "USDC"
    }
  ]
};

function getDefaultToken(chainId: number) {
  return TOKENS_BY_CHAIN[chainId]?.[1]?.address ?? TOKENS_BY_CHAIN[chainId]?.[0]?.address ?? "";
}

function getTokenOptions(chainId: number) {
  return TOKENS_BY_CHAIN[chainId] ?? [];
}

function getTokenMetadata(chainId: number, tokenAddress: string) {
  return getTokenOptions(chainId).find(
    (token) => token.address.toLowerCase() === tokenAddress.trim().toLowerCase()
  );
}

function formatDuration(seconds?: number) {
  if (!seconds) {
    return "Unavailable";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatUsd(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
    style: "currency"
  }).format(value);
}

function formatTokenAmount(amount: string | undefined, decimals: number) {
  if (!amount) {
    return "Unavailable";
  }

  try {
    const formatted = Number.parseFloat(formatUnits(BigInt(amount), decimals));

    if (!Number.isFinite(formatted)) {
      return "Unavailable";
    }

    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: formatted < 1 ? 6 : 4
    }).format(formatted);
  } catch {
    return "Unavailable";
  }
}

function getRouteLabel(route: QuoteRoute) {
  if (route.usedBridgeNames?.length) {
    return route.usedBridgeNames.join(" -> ");
  }

  const stepNames =
    route.userTxs?.flatMap((userTx) =>
      userTx.steps?.map(
        (step) => step.protocolName || step.tool || step.stepType || "Route step"
      ) ?? []
    ) ?? [];

  const uniqueStepNames = [...new Set(stepNames)];

  return uniqueStepNames.length
    ? uniqueStepNames.join(" -> ")
    : "Best available route";
}

function getEstimatedOutput(route: QuoteRoute) {
  return route.toAmount || route.outputAmount || route.receivedAmount;
}

function getStatusLabel(statusCode?: number) {
  switch (statusCode) {
    case 0:
      return "Pending";
    case 1:
      return "Assigned";
    case 2:
      return "Extracted";
    case 3:
      return "Fulfilled";
    case 4:
      return "Settled";
    case 5:
      return "Expired";
    case 6:
      return "Cancelled";
    case 7:
      return "Refunded";
    default:
      return "Unknown";
  }
}

function shortHash(hash: string | null) {
  if (!hash) {
    return null;
  }

  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function SwapWidget() {
  const wallet = useWallet();
  const sourceTokenListId = useId();
  const destinationTokenListId = useId();

  const [sourceChainId, setSourceChainId] = useState(1);
  const [destinationChainId, setDestinationChainId] = useState(1);
  const [inputToken, setInputToken] = useState(
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  );
  const [outputToken, setOutputToken] = useState(
    "0x3898257dD2Cd6d2A3b6e3435f73568A725262b9B"
  );
  const [amount, setAmount] = useState("1");
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [statusPayload, setStatusPayload] = useState<StatusResponse | null>(null);
  const [sourceTxHash, setSourceTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (!inputToken) {
      setInputToken(getDefaultToken(sourceChainId));
    }
  }, [inputToken, sourceChainId]);

  useEffect(() => {
    if (!outputToken) {
      setOutputToken(getDefaultToken(destinationChainId));
    }
  }, [destinationChainId, outputToken]);

  const inputTokenMeta =
    getTokenMetadata(sourceChainId, inputToken) ?? getTokenOptions(sourceChainId)[0];
  const outputTokenMeta =
    getTokenMetadata(destinationChainId, outputToken) ??
    getTokenOptions(destinationChainId)[0];

  const handleGetQuote = async () => {
    if (!wallet.address) {
      setQuoteError("Connect a wallet before requesting a quote.");
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setQuoteError("Enter an amount greater than zero.");
      return;
    }

    setQuoteLoading(true);
    setQuoteError(null);
    setSwapStatus(null);
    setStatusPayload(null);
    setSourceTxHash(null);

    try {
      const normalizedAmount = parseUnits(
        amount,
        inputTokenMeta?.decimals ?? 18
      ).toString();

      const response = await getQuote({
        userAddress: wallet.address,
        receiverAddress: wallet.address,
        originChainId: sourceChainId,
        destinationChainId,
        inputAmount: normalizedAmount,
        inputToken: inputToken.trim(),
        outputToken: outputToken.trim()
      });

      startTransition(() => {
        setQuote({
          inputAmountBaseUnits: normalizedAmount,
          route: response.bestRoute,
          serverReqId: response.serverReqId ?? null
        });
      });
    } catch (caughtError) {
      setQuote(null);
      setQuoteError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to fetch a quote from Bungee."
      );
    } finally {
      setQuoteLoading(false);
    }
  };

  const ensureApprovalIfNeeded = async (approvalData: ApprovalData | null | undefined) => {
    if (
      !approvalData?.tokenAddress ||
      approvalData.tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS
    ) {
      return;
    }

    if (!wallet.address) {
      throw new Error("Wallet is not connected.");
    }

    const publicClient = wallet.getPublicClient(sourceChainId);
    const walletClient = wallet.getWalletClient(sourceChainId);
    const spender =
      approvalData.spenderAddress === "0"
        ? PERMIT2_ADDRESS
        : approvalData.spenderAddress;

    const currentAllowance = await publicClient.readContract({
      address: approvalData.tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [wallet.address as Address, spender as Address]
    });

    if (currentAllowance >= BigInt(approvalData.amount)) {
      setSwapStatus("Approval already satisfied. Sending swap transaction.");
      return;
    }

    setSwapStatus("Submitting token approval.");

    const approvalHash = await walletClient.sendTransaction({
      account: wallet.address as Address,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender as Address, BigInt(approvalData.amount)]
      }),
      to: approvalData.tokenAddress as Address,
      value: 0n
    });

    setSwapStatus(`Approval submitted: ${shortHash(approvalHash)}`);
    await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    setSwapStatus("Approval confirmed. Preparing swap transaction.");
  };

  const pollStatus = async (requestHash: string) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await checkStatus(requestHash);
      setStatusPayload(response);
      setSwapStatus(`Bridge status: ${getStatusLabel(response.bungeeStatusCode)}`);

      if ([3, 4].includes(response.bungeeStatusCode ?? -1)) {
        return response;
      }

      if ([5, 6, 7].includes(response.bungeeStatusCode ?? -1)) {
        throw new Error(
          `Bridge request ended with status ${getStatusLabel(response.bungeeStatusCode)}.`
        );
      }

      await sleep(5000);
    }

    return null;
  };

  const handleSwap = async () => {
    if (!quote?.route.quoteId) {
      setSwapStatus("Request a quote before submitting a swap.");
      return;
    }

    if (!wallet.address) {
      setSwapStatus("Connect a wallet before submitting the swap.");
      return;
    }

    setSwapLoading(true);
    setSwapStatus(null);
    setStatusPayload(null);
    setSourceTxHash(null);

    try {
      const currentSourceChain = findSupportedChain(sourceChainId);
      if (!currentSourceChain) {
        throw new Error(`Unsupported source chain ${sourceChainId}.`);
      }

      if (wallet.chainId !== sourceChainId) {
        setSwapStatus(`Switching wallet to ${currentSourceChain.name}.`);
        await wallet.switchToChain(sourceChainId);
      }

      setSwapStatus("Building transaction with Bungee.");
      const buildResult = await buildTx(quote.route.quoteId);

      await ensureApprovalIfNeeded(buildResult.approvalData);

      setSwapStatus("Submitting swap transaction.");

      const walletClient = wallet.getWalletClient(sourceChainId);
      const publicClient = wallet.getPublicClient(sourceChainId);

      const txHash = await walletClient.sendTransaction({
        account: wallet.address as Address,
        chain: currentSourceChain.viemChain,
        data: (buildResult.txData.data ?? "0x") as Hex,
        to: buildResult.txData.to as Address,
        value: buildResult.txData.value ? BigInt(buildResult.txData.value) : 0n
      });

      setSourceTxHash(txHash);
      setSwapStatus(`Swap submitted: ${shortHash(txHash)}`);

      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setSwapStatus("Source transaction confirmed. Waiting for bridge execution.");

      const finalStatus = await pollStatus(buildResult.requestHash ?? txHash);

      if (finalStatus) {
        setSwapStatus(
          finalStatus.destinationData?.txHash
            ? `Swap complete. Destination tx: ${shortHash(finalStatus.destinationData.txHash)}`
            : "Swap complete."
        );
      } else {
        setSwapStatus(
          "Source transaction succeeded. Status polling timed out before a terminal bridge state was returned."
        );
      }
    } catch (caughtError) {
      setSwapStatus(
        caughtError instanceof Error
          ? caughtError.message
          : "Swap execution failed."
      );
    } finally {
      setSwapLoading(false);
    }
  };

  const estimatedOutput = quote ? getEstimatedOutput(quote.route) : undefined;
  const routeLabel = quote ? getRouteLabel(quote.route) : "Request a quote";
  const feeLabel = quote ? formatUsd(quote.route.totalGasFeesInUsd) : "Unavailable";
  const durationLabel = quote
    ? formatDuration(quote.route.serviceTime || quote.route.maxServiceTime)
    : "Unavailable";
  const selectedWalletLabel = wallet.selectedWallet?.label ?? "Wallet";
  const selectedWalletInstalled = Boolean(wallet.selectedWallet?.installed);
  const connectButtonLabel = wallet.isConnecting
    ? `Connecting ${selectedWalletLabel}...`
    : wallet.shortAddress
      ? `Connected: ${selectedWalletLabel}`
      : `Connect ${selectedWalletLabel}`;

  return (
    <div className="bw-app">
      <div className="bw-card">
        <div className="bw-header">
          <div>
            <p className="bw-eyebrow">MBTC Swap</p>
            <h1>MBTC Swap</h1>
          </div>
          <div className="bw-badges">
            <span className="bw-badge">{BUNGEE_ENVIRONMENT_LABEL}</span>
            <span className="bw-badge bw-badge-accent">
              {wallet.shortAddress ?? "Wallet disconnected"}
            </span>
          </div>
        </div>

        <p className="bw-description">
          Embed this widget anywhere. It mounts inside a shadow root, supports
          MetaMask, Coinbase Wallet, and Uniswap Extension, fetches Bungee
          quotes, and submits the selected route from the source chain.
        </p>

        <div className="bw-wallet-stack">
          <div className="bw-wallet-picker">
            {wallet.wallets.map((walletOption) => (
              <button
                key={walletOption.id}
                className={`bw-wallet-option${
                  walletOption.id === wallet.selectedWalletId
                    ? " bw-wallet-option-active"
                    : ""
                }${walletOption.installed ? "" : " bw-wallet-option-disabled"}`}
                onClick={() => {
                  wallet.selectWallet(walletOption.id);
                }}
                type="button"
              >
                <span>{walletOption.label}</span>
                <small>{walletOption.installed ? "Detected" : "Unavailable"}</small>
              </button>
            ))}
          </div>

          <div className="bw-wallet-row">
            <button
              className="bw-button bw-button-secondary"
              disabled={!selectedWalletInstalled || wallet.isConnecting || swapLoading}
              onClick={() => {
                void wallet.connect().catch((error: unknown) => {
                  setSwapStatus(
                    error instanceof Error
                      ? error.message
                      : `Failed to connect ${selectedWalletLabel}.`
                  );
                });
              }}
              type="button"
            >
              {connectButtonLabel}
            </button>

            <div className="bw-wallet-meta">
              <span>Selected wallet: {selectedWalletLabel}</span>
              <span>
                {wallet.chainId
                  ? `Current network: ${
                      findSupportedChain(wallet.chainId)?.name ?? `Chain ${wallet.chainId}`
                    }`
                  : "No network selected"}
              </span>
              {!wallet.hasProvider ? (
                <span>
                  No supported injected wallet detected. Install MetaMask,
                  Coinbase Wallet, or Uniswap Extension.
                </span>
              ) : null}
              {wallet.hasProvider && !selectedWalletInstalled ? (
                <span>{selectedWalletLabel} is not installed in this browser.</span>
              ) : null}
              {wallet.error ? <span>{wallet.error}</span> : null}
            </div>
          </div>
        </div>

        <div className="bw-grid">
          <label className="bw-field">
            <span>Source chain</span>
            <select
              value={sourceChainId}
              onChange={(event) => {
                const nextChainId = Number(event.target.value);
                setSourceChainId(nextChainId);
                setInputToken(getDefaultToken(nextChainId));
                setQuote(null);
              }}
            >
              {SUPPORTED_CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>

          <label className="bw-field">
            <span>Destination chain</span>
            <select
              value={destinationChainId}
              onChange={(event) => {
                const nextChainId = Number(event.target.value);
                setDestinationChainId(nextChainId);
                setOutputToken(getDefaultToken(nextChainId));
                setQuote(null);
              }}
            >
              {SUPPORTED_CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>

          <label className="bw-field">
            <span>Input token</span>
            <input
              list={sourceTokenListId}
              onChange={(event) => {
                setInputToken(event.target.value);
                setQuote(null);
              }}
              placeholder={`0x... or ${NATIVE_TOKEN_ADDRESS}`}
              spellCheck={false}
              type="text"
              value={inputToken}
            />
            <datalist id={sourceTokenListId}>
              {getTokenOptions(sourceChainId).map((token) => (
                <option key={token.address} value={token.address}>
                  {token.symbol} · {token.name}
                </option>
              ))}
            </datalist>
            <small>{inputTokenMeta?.symbol ?? "Custom token"} on source chain</small>
          </label>

          <label className="bw-field">
            <span>Output token</span>
            <input
              list={destinationTokenListId}
              onChange={(event) => {
                setOutputToken(event.target.value);
                setQuote(null);
              }}
              placeholder={`0x... or ${NATIVE_TOKEN_ADDRESS}`}
              spellCheck={false}
              type="text"
              value={outputToken}
            />
            <datalist id={destinationTokenListId}>
              {getTokenOptions(destinationChainId).map((token) => (
                <option key={token.address} value={token.address}>
                  {token.symbol} · {token.name}
                </option>
              ))}
            </datalist>
            <small>{outputTokenMeta?.symbol ?? "Custom token"} on destination chain</small>
          </label>

          <label className="bw-field bw-field-full">
            <span>Amount</span>
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => {
                setAmount(event.target.value);
                setQuote(null);
              }}
              placeholder="1.0"
              step="any"
              type="number"
              value={amount}
            />
          </label>
        </div>

        <div className="bw-actions">
          <button
            className="bw-button"
            disabled={quoteLoading || swapLoading}
            onClick={() => {
              void handleGetQuote();
            }}
            type="button"
          >
            {quoteLoading ? "Fetching quote..." : "Get Quote"}
          </button>

          <button
            className="bw-button bw-button-secondary"
            disabled={!quote || quoteLoading || swapLoading}
            onClick={() => {
              void handleSwap();
            }}
            type="button"
          >
            {swapLoading ? "Swapping..." : "Swap"}
          </button>
        </div>

        <div className="bw-summary">
          <div className="bw-summary-row">
            <span>Best route</span>
            <strong>{routeLabel}</strong>
          </div>
          <div className="bw-summary-row">
            <span>Estimated output</span>
            <strong>
              {quote
                ? `${formatTokenAmount(
                    estimatedOutput,
                    outputTokenMeta?.decimals ?? 18
                  )} ${outputTokenMeta?.symbol ?? ""}`.trim()
                : "Unavailable"}
            </strong>
          </div>
          <div className="bw-summary-row">
            <span>Fees</span>
            <strong>{feeLabel}</strong>
          </div>
          <div className="bw-summary-row">
            <span>Time estimate</span>
            <strong>{durationLabel}</strong>
          </div>
          <div className="bw-summary-row">
            <span>Tx status</span>
            <strong>{swapStatus ?? "Idle"}</strong>
          </div>
        </div>

        {quote?.serverReqId ? (
          <p className="bw-footnote">Quote request ID: {quote.serverReqId}</p>
        ) : null}

        {sourceTxHash ? (
          <p className="bw-footnote">Source tx: {sourceTxHash}</p>
        ) : null}

        {statusPayload?.destinationData?.txHash ? (
          <p className="bw-footnote">
            Destination tx: {statusPayload.destinationData.txHash}
          </p>
        ) : null}

        {quoteError ? <p className="bw-error">{quoteError}</p> : null}
      </div>
    </div>
  );
}
