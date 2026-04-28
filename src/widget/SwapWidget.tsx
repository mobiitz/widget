import { startTransition, useEffect, useId, useState } from "react";
import type { Address, Hex } from "viem";
import {
  encodeFunctionData,
  formatUnits,
  parseAbi,
  parseUnits
} from "viem";
import {
  getQuote,
  ZEROX_ENVIRONMENT_LABEL,
  type ZeroExQuote
} from "../services/zerox";
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
  requestId: string | null;
  route: ZeroExQuote;
};

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
]);
const ETHEREUM_ONLY_CHAINS = SUPPORTED_CHAINS.filter((chain) => chain.id === 1);

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

function getRouteLabel(route: ZeroExQuote) {
  const fills = route.route?.fills ?? [];
  const uniqueSources = [...new Set(fills.map((fill) => fill.source))];
  return uniqueSources.length ? uniqueSources.join(" -> ") : "Best available route";
}

function getEstimatedOutput(route: ZeroExQuote) {
  return route.buyAmount;
}

function shortHash(hash: string | null) {
  if (!hash) {
    return null;
  }

  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
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
    setSourceTxHash(null);

    try {
      const normalizedAmount = parseUnits(
        amount,
        inputTokenMeta?.decimals ?? 18
      ).toString();

      const response = await getQuote({
        buyToken: outputToken.trim(),
        chainId: sourceChainId,
        sellAmount: normalizedAmount,
        sellToken: inputToken.trim(),
        taker: wallet.address
      });

      startTransition(() => {
        setQuote({
          inputAmountBaseUnits: normalizedAmount,
          requestId: response.requestId,
          route: response.quote
        });
      });
    } catch (caughtError) {
      setQuote(null);
      setQuoteError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to fetch a quote from 0x."
      );
    } finally {
      setQuoteLoading(false);
    }
  };

  const ensureApprovalIfNeeded = async (
    quoteRoute: ZeroExQuote,
    fallbackSellAmount: string
  ) => {
    if (inputToken.toLowerCase() === NATIVE_TOKEN_ADDRESS) {
      return;
    }

    if (!wallet.address) {
      throw new Error("Wallet is not connected.");
    }

    const publicClient = wallet.getPublicClient(sourceChainId);
    const walletClient = wallet.getWalletClient(sourceChainId);
    const spender =
      quoteRoute.issues?.allowance?.spender || quoteRoute.allowanceTarget;
    const approvalAmount = quoteRoute.sellAmount ?? fallbackSellAmount;

    if (!spender || !approvalAmount) {
      return;
    }

    const currentAllowance = await publicClient.readContract({
      address: inputToken as Address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [wallet.address as Address, spender as Address]
    });

    if (currentAllowance >= BigInt(approvalAmount)) {
      setSwapStatus("Approval already satisfied. Sending swap transaction.");
      return;
    }

    setSwapStatus("Submitting token approval.");

    const approvalHash = await walletClient.sendTransaction({
      account: wallet.address as Address,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender as Address, BigInt(approvalAmount)]
      }),
      to: inputToken as Address,
      value: 0n
    });

    setSwapStatus(`Approval submitted: ${shortHash(approvalHash)}`);
    await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    setSwapStatus("Approval confirmed. Preparing swap transaction.");
  };

  const handleSwap = async () => {
    if (!quote?.route.transaction?.to) {
      setSwapStatus("Request a quote before submitting a swap.");
      return;
    }

    if (!wallet.address) {
      setSwapStatus("Connect a wallet before submitting the swap.");
      return;
    }

    setSwapLoading(true);
    setSwapStatus(null);
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

      setSwapStatus("Checking allowance for 0x execution.");

      await ensureApprovalIfNeeded(quote.route, quote.inputAmountBaseUnits);

      setSwapStatus("Submitting swap transaction.");

      const walletClient = wallet.getWalletClient(sourceChainId);
      const publicClient = wallet.getPublicClient(sourceChainId);

      const txHash = await walletClient.sendTransaction({
        account: wallet.address as Address,
        chain: currentSourceChain.viemChain,
        data: (quote.route.transaction?.data ?? "0x") as Hex,
        to: quote.route.transaction.to as Address,
        value: quote.route.transaction?.value
          ? BigInt(quote.route.transaction.value)
          : 0n
      });

      setSourceTxHash(txHash);
      setSwapStatus(`Swap submitted: ${shortHash(txHash)}`);

      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setSwapStatus("Swap complete.");
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
  const feeLabel = quote
    ? [
        quote.route.fees?.integratorFee?.amount
          ? `${formatTokenAmount(
              quote.route.fees.integratorFee.amount,
              inputTokenMeta?.decimals ?? 18
            )} ${inputTokenMeta?.symbol ?? "SELL"}`
          : null,
        quote.route.totalNetworkFee
          ? `${formatTokenAmount(quote.route.totalNetworkFee, 18)} ETH network`
          : null
      ]
        .filter(Boolean)
        .join(" + ") || "Unavailable"
    : "Unavailable";
  const durationLabel = quote ? "Ethereum confirmation" : "Unavailable";
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
            <span className="bw-badge">{ZEROX_ENVIRONMENT_LABEL}</span>
            <span className="bw-badge bw-badge-accent">
              {wallet.shortAddress ?? "Wallet disconnected"}
            </span>
          </div>
        </div>

        <p className="bw-description">
          Embed this widget anywhere. It mounts inside a shadow root, supports
          MetaMask, Coinbase Wallet, and Uniswap Extension, fetches 0x quotes,
          and swaps USDC for MBTC on Ethereum mainnet.
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
              disabled
              onChange={(event) => {
                const nextChainId = Number(event.target.value);
                setSourceChainId(nextChainId);
                setInputToken(getDefaultToken(nextChainId));
                setQuote(null);
              }}
            >
              {ETHEREUM_ONLY_CHAINS.map((chain) => (
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
              disabled
              onChange={(event) => {
                const nextChainId = Number(event.target.value);
                setDestinationChainId(nextChainId);
                setOutputToken(getDefaultToken(nextChainId));
                setQuote(null);
              }}
            >
              {ETHEREUM_ONLY_CHAINS.map((chain) => (
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

        {quote?.requestId ? (
          <p className="bw-footnote">0x request ID: {quote.requestId}</p>
        ) : null}

        {sourceTxHash ? (
          <p className="bw-footnote">Source tx: {sourceTxHash}</p>
        ) : null}

        {quoteError ? <p className="bw-error">{quoteError}</p> : null}
      </div>
    </div>
  );
}
