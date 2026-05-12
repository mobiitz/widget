import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { flushSync } from "react-dom";
import type { Address, Hex } from "viem";
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseAbi,
  parseUnits
} from "viem";
import { ETHEREUM_TOKENS, type TokenOption } from "../data/ethereumTokens";
import { getQuote, type ZeroExQuote } from "../services/zerox";
import {
  NATIVE_TOKEN_ADDRESS,
  SUPPORTED_CHAINS,
  findSupportedChain,
  useWallet
} from "../hooks/useWallet";

type QuoteState = {
  inputAmountBaseUnits: string;
  requestId: string | null;
  route: ZeroExQuote;
};

type SwapStage =
  | "idle"
  | "preparing"
  | "switching"
  | "checkingAllowance"
  | "awaitingApproval"
  | "approvalPending"
  | "approvalConfirmed"
  | "awaitingSwap"
  | "swapPending"
  | "complete"
  | "error";

type TokenPickerProps = {
  label: string;
  onSelect: (token: TokenOption) => void;
  options: TokenOption[];
  selectedToken: TokenOption;
  trailingLabel?: string | null;
};

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
]);
const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const DEFAULT_SOURCE_TOKEN = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const DEFAULT_SOURCE_CHAIN_ID = 1;
const DEFAULT_DESTINATION_TOKEN = getAddress("0x3898257dD2Cd6d2A3b6e3435f73568A725262b9B");
const DEFAULT_DESTINATION_CHAIN_ID = 1;
const QUOTE_REFRESH_INTERVAL_MS = 30_000;
const INPUT_TOKEN_OPTIONS = ETHEREUM_TOKENS.filter(
  (token) =>
    (token.chainId === 1 &&
      [
        DEFAULT_SOURCE_TOKEN.toLowerCase(),
        NATIVE_TOKEN_ADDRESS,
        getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7").toLowerCase(),
        getAddress("0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d").toLowerCase()
      ].includes(token.address.toLowerCase())) ||
    (token.chainId === 8453 &&
      token.address.toLowerCase() ===
        getAddress("0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913").toLowerCase())
);
const OUTPUT_TOKEN_OPTIONS = ETHEREUM_TOKENS.filter((token) => token.symbol === "MBTC");
const SWAP_PROGRESS: Record<SwapStage, number> = {
  idle: 0,
  preparing: 10,
  switching: 18,
  checkingAllowance: 28,
  awaitingApproval: 42,
  approvalPending: 56,
  approvalConfirmed: 68,
  awaitingSwap: 78,
  swapPending: 90,
  complete: 100,
  error: 100
};
const SWAP_STAGE_LABEL: Record<SwapStage, string> = {
  idle: "Waiting to start",
  preparing: "Preparing swap",
  switching: "Switching network",
  checkingAllowance: "Checking allowance",
  awaitingApproval: "Waiting for approval confirmation",
  approvalPending: "Approval pending onchain",
  approvalConfirmed: "Approval confirmed",
  awaitingSwap: "Waiting for swap confirmation",
  swapPending: "Swap pending onchain",
  complete: "Swap complete",
  error: "Swap failed"
};

function getDefaultToken(address: string, chainId: number) {
  return (
    ETHEREUM_TOKENS.find(
      (token) =>
        token.chainId === chainId &&
        token.address.toLowerCase() === address.toLowerCase()
    ) ?? ETHEREUM_TOKENS[0]
  );
}

function getTokenIconUrl(address: string, chainId: number) {
  if (address.toLowerCase() === NATIVE_TOKEN_ADDRESS) {
    return "https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains/ethereum/info/logo.png";
  }

  const chainSlug = chainId === 8453 ? "base" : "ethereum";
  return `https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains/${chainSlug}/assets/${getAddress(address)}/logo.png`;
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

function shortHash(hash: string | null) {
  if (!hash) {
    return null;
  }

  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
function TokenIcon({
  address,
  chainId,
  logoURI,
  symbol
}: {
  address: string;
  chainId: number;
  logoURI?: string;
  symbol: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const fallbackLabel = symbol.slice(0, 3).toUpperCase();

  if (imageFailed) {
    return <span className="bw-token-icon-fallback">{fallbackLabel}</span>;
  }

  return (
    <img
      alt={`${symbol} token icon`}
      className="bw-token-icon"
      loading="lazy"
      onError={() => {
        setImageFailed(true);
      }}
      src={logoURI || getTokenIconUrl(address, chainId)}
    />
  );
}

function TokenPicker({
  label,
  onSelect,
  options,
  selectedToken,
  trailingLabel
}: TokenPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }

    const handleDocumentPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
    };
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    return normalizedQuery
      ? options.filter((token) =>
          [token.symbol, token.name, token.address].some((value) =>
            value.toLowerCase().includes(normalizedQuery)
          )
        )
      : options;
  }, [deferredQuery, options]);

  return (
    <div className="bw-token-field" ref={containerRef}>
      <div className="bw-field-heading">
        <span>{label}</span>
        {trailingLabel ? <small>{trailingLabel}</small> : null}
      </div>
      <button
        aria-expanded={isOpen}
        className={`bw-picker-trigger${isOpen ? " bw-picker-trigger-active" : ""}`}
        onClick={() => {
          setIsOpen((current) => !current);
        }}
        type="button"
      >
        <span className="bw-picker-value">
          <TokenIcon
            address={selectedToken.address}
            chainId={selectedToken.chainId}
            logoURI={selectedToken.logoURI}
            symbol={selectedToken.symbol}
          />
          <span className="bw-picker-copy">
            <strong>{selectedToken.symbol}</strong>
            <small>{selectedToken.name}</small>
          </span>
        </span>
        <span className="bw-picker-caret">{isOpen ? "−" : "+"}</span>
      </button>

      {isOpen ? (
        <div className="bw-token-popover">
          <input
            autoFocus
            className="bw-token-search"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search symbol or name"
            spellCheck={false}
            type="text"
            value={query}
          />

          <div className="bw-token-list">
            {filteredOptions.map((token) => (
              <button
                className={`bw-token-option${
                  token.chainId === selectedToken.chainId &&
                  token.address.toLowerCase() === selectedToken.address.toLowerCase()
                    ? " bw-token-option-active"
                    : ""
                }`}
                key={`${token.chainId}:${token.address}`}
                onClick={() => {
                  onSelect(token);
                  setIsOpen(false);
                }}
                type="button"
              >
                <span className="bw-token-option-main">
                  <TokenIcon
                    address={token.address}
                    chainId={token.chainId}
                    logoURI={token.logoURI}
                    symbol={token.symbol}
                  />
                  <span className="bw-token-option-copy">
                    <strong>{token.symbol}</strong>
                    <small>{token.name}</small>
                  </span>
                </span>
                <small>{shortHash(token.address) ?? token.address}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SwapWidget() {
  const wallet = useWallet();
  const [inputToken, setInputToken] = useState<TokenOption>(() =>
    getDefaultToken(DEFAULT_SOURCE_TOKEN, DEFAULT_SOURCE_CHAIN_ID)
  );
  const [outputToken, setOutputToken] = useState<TokenOption>(() =>
    getDefaultToken(DEFAULT_DESTINATION_TOKEN, DEFAULT_DESTINATION_CHAIN_ID)
  );
  const [amount, setAmount] = useState("1");
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapStage, setSwapStage] = useState<SwapStage>("idle");
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [sourceTxHash, setSourceTxHash] = useState<string | null>(null);
  const [quoteLastUpdatedAt, setQuoteLastUpdatedAt] = useState<number | null>(null);
  const [quoteRefreshLabel, setQuoteRefreshLabel] = useState<string | null>(null);
  const [inputTokenBalanceLabel, setInputTokenBalanceLabel] = useState<string | null>(null);
  const sourceChainId = inputToken.chainId;
  const sourceChainName = findSupportedChain(sourceChainId)?.name ?? `Chain ${sourceChainId}`;

  const readProviderUint256 = async (
    contractAddress: Address,
    data: Hex
  ) => {
    const provider = wallet.selectedWallet?.provider;
    if (!provider) {
      throw new Error("Wallet provider is unavailable.");
    }

    const response = await provider.request({
      method: "eth_call",
      params: [
        {
          to: contractAddress,
          data
        },
        "latest"
      ]
    });

    if (typeof response !== "string") {
      throw new Error("Wallet returned an unreadable contract response.");
    }

    return BigInt(response);
  };

  const waitForWalletReceipt = async (hash: Hex) => {
    const provider = wallet.selectedWallet?.provider;
    if (!provider) {
      throw new Error("Wallet provider is unavailable.");
    }

    const timeoutAt = Date.now() + 180_000;

    while (Date.now() < timeoutAt) {
      const receipt = await provider.request({
        method: "eth_getTransactionReceipt",
        params: [hash]
      });

      if (receipt && typeof receipt === "object") {
        const status =
          "status" in receipt ? (receipt as { status?: string }).status : undefined;

        if (status === "0x0") {
          throw new Error("Transaction reverted.");
        }

        return receipt;
      }

      await sleep(1_500);
    }

    throw new Error("Timed out waiting for transaction confirmation.");
  };

  const availableOutputOptions = useMemo(
    () =>
      OUTPUT_TOKEN_OPTIONS.filter((token) => token.chainId === inputToken.chainId),
    [inputToken.chainId]
  );

  useEffect(() => {
    if (!wallet.address || wallet.chainId === sourceChainId) {
      return;
    }

    void wallet.switchToChain(sourceChainId).catch(() => {
      // The balance loader and swap flow surface a clearer status if the user rejects.
    });
  }, [sourceChainId, wallet]);

  useEffect(() => {
    let isActive = true;

    const loadInputTokenBalance = async () => {
      if (!wallet.address) {
        setInputTokenBalanceLabel(null);
        return;
      }

      if (wallet.chainId !== sourceChainId) {
        setInputTokenBalanceLabel(`Switching to ${sourceChainName}...`);

        try {
          await wallet.switchToChain(sourceChainId);
        } catch {
          if (!isActive) {
            return;
          }

          setInputTokenBalanceLabel(`Switch to ${sourceChainName} to view balance`);
        }
        return;
      }

      setInputTokenBalanceLabel("Loading balance...");

      try {
        const rawBalance =
          inputToken.address.toLowerCase() === NATIVE_TOKEN_ADDRESS
            ? await wallet.selectedWallet?.provider?.request({
                method: "eth_getBalance",
                params: [wallet.address, "latest"]
              })
            : await readProviderUint256(
                inputToken.address as Address,
                encodeFunctionData({
                  abi: ERC20_BALANCE_ABI,
                  functionName: "balanceOf",
                  args: [wallet.address as Address]
                })
              );

        const normalizedBalance =
          typeof rawBalance === "bigint"
            ? rawBalance
            : typeof rawBalance === "string"
              ? BigInt(rawBalance)
              : null;

        if (normalizedBalance === null) {
          throw new Error("Unreadable wallet balance response.");
        }

        if (!isActive) {
          return;
        }

        setInputTokenBalanceLabel(
          `Balance: ${formatTokenAmount(
            normalizedBalance.toString(),
            inputToken.decimals
          )} ${inputToken.symbol}`
        );
      } catch {
        if (!isActive) {
          return;
        }

        setInputTokenBalanceLabel("Balance unavailable");
      }
    };

    void loadInputTokenBalance();

    return () => {
      isActive = false;
    };
  }, [
    inputToken.address,
    inputToken.chainId,
    inputToken.decimals,
    inputToken.symbol,
    sourceChainId,
    sourceChainName,
    wallet.address,
    wallet.chainId,
    wallet.selectedWalletId
  ]);

  const requestQuote = async (reason: "manual" | "refresh") => {
    if (!wallet.address) {
      if (reason === "manual") {
        setQuoteError("Connect a wallet before requesting a quote.");
      }
      return;
    }

    if (!amount || Number(amount) <= 0) {
      if (reason === "manual") {
        setQuoteError("Enter an amount greater than zero.");
      }
      return;
    }

    if (reason === "manual") {
      setQuoteLoading(true);
      setQuoteRefreshLabel(null);
      setSwapStage("idle");
      setSwapStatus(null);
      setSourceTxHash(null);
    } else {
      setQuoteRefreshLabel("Refreshing quote...");
    }

    setQuoteError(null);

    try {
      const normalizedAmount = parseUnits(amount, inputToken.decimals).toString();
      const response = await getQuote({
        buyToken: outputToken.address,
        chainId: sourceChainId,
        sellAmount: normalizedAmount,
        sellToken: inputToken.address,
        taker: wallet.address
      });

      startTransition(() => {
        setQuote({
          inputAmountBaseUnits: normalizedAmount,
          requestId: response.requestId,
          route: response.quote
        });
      });
      setQuoteLastUpdatedAt(Date.now());
      setQuoteRefreshLabel(reason === "refresh" ? "Quote refreshed" : "Quote updated");
    } catch (caughtError) {
      if (reason === "manual") {
        setQuote(null);
        setQuoteError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to fetch a quote from 0x."
        );
      } else {
        setQuoteRefreshLabel("Refresh failed");
      }
    } finally {
      if (reason === "manual") {
        setQuoteLoading(false);
      }
    }
  };

  const handleGetQuote = async () => {
    await requestQuote("manual");
  };

  useEffect(() => {
    if (!quote || !wallet.address || swapLoading) {
      return;
    }

    const refreshTimer = window.setInterval(() => {
      void requestQuote("refresh");
    }, QUOTE_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshTimer);
    };
  }, [
    amount,
    inputToken.address,
    inputToken.decimals,
    outputToken.address,
    quote,
    sourceChainId,
    swapLoading,
    wallet.address
  ]);

  const ensureApprovalIfNeeded = async (
    quoteRoute: ZeroExQuote,
    fallbackSellAmount: string
  ) => {
    if (inputToken.address.toLowerCase() === NATIVE_TOKEN_ADDRESS) {
      return;
    }

    if (!wallet.address) {
      throw new Error("Wallet is not connected.");
    }

    const spender = quoteRoute.issues?.allowance?.spender || quoteRoute.allowanceTarget;
    const approvalAmount = quoteRoute.sellAmount ?? fallbackSellAmount;

    if (!spender || !approvalAmount) {
      return;
    }

    const quotedAllowance = quoteRoute.issues?.allowance?.actual;
    const currentAllowance =
      quotedAllowance !== undefined
        ? BigInt(quotedAllowance)
        : await readProviderUint256(
            inputToken.address as Address,
            encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "allowance",
              args: [wallet.address as Address, spender as Address]
            })
          );

    if (currentAllowance >= BigInt(approvalAmount)) {
      setSwapStage("approvalConfirmed");
      setSwapStatus("Approval already satisfied. Sending swap transaction.");
      return;
    }

    flushSync(() => {
      setSwapStage("awaitingApproval");
      setSwapStatus("Approval required. Confirm the approval in your wallet.");
    });
    await nextFrame();

    const approvalHash = await wallet.sendTransaction(sourceChainId, {
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender as Address, BigInt(approvalAmount)]
      }),
      to: inputToken.address as Address,
      value: 0n
    });

    setSwapStage("approvalPending");
    setSwapStatus(`Approval submitted: ${shortHash(approvalHash)}`);
    await waitForWalletReceipt(approvalHash);
    setSwapStage("approvalConfirmed");
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

    flushSync(() => {
      setSwapLoading(true);
      setSwapStage("preparing");
      setSwapStatus("Preparing swap...");
      setSourceTxHash(null);
    });

    try {
      const currentSourceChain = findSupportedChain(sourceChainId);
      if (!currentSourceChain) {
        throw new Error(`Unsupported source chain ${sourceChainId}.`);
      }

      if (quote.route.issues?.balance?.actual && quote.route.issues?.balance?.expected) {
        const actualBalance = BigInt(quote.route.issues.balance.actual);
        const expectedBalance = BigInt(quote.route.issues.balance.expected);
        if (actualBalance < expectedBalance) {
          throw new Error("Insufficient token balance for this swap.");
        }
      }

      if (wallet.chainId !== sourceChainId) {
        setSwapStage("switching");
        setSwapStatus(`Switching wallet to ${currentSourceChain.name}.`);
        await wallet.switchToChain(sourceChainId);
      }

      setSwapStage("checkingAllowance");
      setSwapStatus("Checking allowance for 0x execution.");
      await ensureApprovalIfNeeded(quote.route, quote.inputAmountBaseUnits);
      flushSync(() => {
        setSwapStage("awaitingSwap");
        setSwapStatus("Open your wallet to submit the swap.");
      });
      await nextFrame();

      const txHash = await wallet.sendTransaction(sourceChainId, {
        data: (quote.route.transaction?.data ?? "0x") as Hex,
        gas: quote.route.transaction?.gas
          ? BigInt(quote.route.transaction.gas)
          : undefined,
        gasPrice: quote.route.transaction?.gasPrice
          ? BigInt(quote.route.transaction.gasPrice)
          : undefined,
        to: quote.route.transaction.to as Address,
        value: quote.route.transaction?.value
          ? BigInt(quote.route.transaction.value)
          : 0n
      });

      setSwapStage("swapPending");
      setSourceTxHash(txHash);
      setSwapStatus(`Swap submitted: ${shortHash(txHash)}`);
      await waitForWalletReceipt(txHash);
      setSwapStage("complete");
      setSwapStatus("Swap complete.");
    } catch (caughtError) {
      setSwapStage("error");
      setSwapStatus(
        caughtError instanceof Error
          ? caughtError.message
          : "Swap execution failed."
      );
    } finally {
      setSwapLoading(false);
    }
  };

  const estimatedOutput = quote?.route.buyAmount;
  const progressValue = SWAP_PROGRESS[swapStage];
  const selectedWalletLabel = wallet.selectedWallet?.label ?? "Wallet";
  const selectedWalletInstalled = Boolean(wallet.selectedWallet?.installed);
  const walletActionLabel = wallet.isConnecting
    ? `Connecting ${selectedWalletLabel}...`
    : wallet.isConnected
      ? "Disconnect Wallet"
      : "Connect Wallet";

  return (
    <div className="bw-app">
      <div className="bw-card">
        <div className="bw-header">
          <div>
            <h1>Buy $MBTC Here</h1>
          </div>
          <div className="bw-badges">
            <span className="bw-badge bw-badge-accent">
              {wallet.shortAddress ?? "Wallet disconnected"}
            </span>
          </div>
        </div>

        <div className="bw-wallet-stack">
          <div className="bw-wallet-controls">
            <label className="bw-wallet-select">
              <span>Wallet</span>
              <select
                onChange={(event) => {
                  wallet.selectWallet(event.target.value as typeof wallet.selectedWalletId);
                }}
                value={wallet.selectedWalletId}
              >
                {wallet.wallets.map((walletOption) => (
                  <option key={walletOption.id} value={walletOption.id}>
                    {walletOption.label}
                    {walletOption.installed ? "" : " (Unavailable)"}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="bw-button bw-button-secondary"
              disabled={
                wallet.isConnected
                  ? wallet.isConnecting || swapLoading
                  : !selectedWalletInstalled || wallet.isConnecting || swapLoading
              }
              onClick={() => {
                if (wallet.isConnected) {
                  wallet.disconnect();
                  setSwapStage("idle");
                  setSwapStatus(null);
                  setSourceTxHash(null);
                  return;
                }

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
              {walletActionLabel}
            </button>
          </div>

          <div className="bw-wallet-meta">
            <span>
              {wallet.isConnected
                ? `Connected: ${wallet.shortAddress}`
                : "Wallet not connected"}
            </span>
            <span>
              {wallet.chainId
                ? `Network: ${
                    findSupportedChain(wallet.chainId)?.name ?? `Chain ${wallet.chainId}`
                  }`
                : "Network: not connected"}
            </span>
            {!wallet.hasProvider ? (
              <span>
                Install MetaMask, Coinbase Wallet, or Uniswap Extension to connect.
              </span>
            ) : null}
            {wallet.hasProvider && !selectedWalletInstalled && !wallet.isConnected ? (
              <span>{selectedWalletLabel} is not installed in this browser.</span>
            ) : null}
            {wallet.error ? <span>{wallet.error}</span> : null}
          </div>
        </div>

        <div className="bw-grid">
          <div className="bw-field bw-field-full">
            <TokenPicker
              label="Input token"
              onSelect={(token) => {
                const nextOutputToken = OUTPUT_TOKEN_OPTIONS.find(
                  (outputOption) => outputOption.chainId === token.chainId
                );
                setInputToken(token);
                if (nextOutputToken) {
                  setOutputToken(nextOutputToken);
                }
                setQuote(null);
                setSwapStage("idle");
                setSwapStatus(null);
              }}
              options={INPUT_TOKEN_OPTIONS}
              selectedToken={inputToken}
              trailingLabel={inputTokenBalanceLabel}
            />
          </div>

          <div className="bw-field bw-field-full">
            <TokenPicker
              label="Output token"
              onSelect={(token) => {
                setOutputToken(token);
                setQuote(null);
                setSwapStage("idle");
                setSwapStatus(null);
              }}
              options={availableOutputOptions}
              selectedToken={outputToken}
            />
          </div>

          <label className="bw-field bw-field-full">
            <span>Amount to spend</span>
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
            {quoteLoading ? "Fetching quote..." : "Step 1. Get Quote"}
          </button>

          <button
            className="bw-button bw-button-secondary"
            disabled={!quote || quoteLoading || swapLoading}
            onClick={() => {
              void handleSwap();
            }}
            type="button"
          >
            {swapLoading ? "Swapping..." : "Step 2. Buy"}
          </button>
        </div>

        <div className="bw-summary">
          <div className="bw-summary-output">
            <span>Estimated output</span>
            <strong>
              {quote
                ? `${formatTokenAmount(
                    estimatedOutput,
                    outputToken.decimals
                  )} ${outputToken.symbol}`.trim()
                : "--"}
            </strong>
          </div>
          <div className="bw-progress">
            <div className="bw-progress-heading">
              <span>Swap progress</span>
              <strong>{progressValue}%</strong>
            </div>
            <div
              aria-label={`Swap progress ${progressValue}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progressValue}
              className={`bw-progress-track${
                swapStage === "error" ? " bw-progress-track-error" : ""
              }`}
              role="progressbar"
            >
              <span
                className={`bw-progress-fill${
                  swapStage === "error" ? " bw-progress-fill-error" : ""
                }`}
                style={{ width: `${progressValue}%` }}
              />
            </div>
            <div className="bw-progress-meta">
              <span>{SWAP_STAGE_LABEL[swapStage]}</span>
              <strong>{swapStatus ?? "Get a quote, then swap."}</strong>
            </div>
          </div>
        </div>

        {quoteLastUpdatedAt ? (
          <p className="bw-footnote">
            {quoteRefreshLabel ?? "Quote updated"} at{" "}
            {new Date(quoteLastUpdatedAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit"
            })}
          </p>
        ) : null}

        {quote?.requestId ? (
          <p className="bw-footnote">0x request ID: {quote.requestId}</p>
        ) : null}

        {quoteError ? <p className="bw-error">{quoteError}</p> : null}
      </div>
    </div>
  );
}
