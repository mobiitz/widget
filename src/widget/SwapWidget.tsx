import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { Address, Hex } from "viem";
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  parseAbi,
  parseUnits
} from "viem";
import { ETHEREUM_TOKENS, type TokenOption } from "../data/ethereumTokens";
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

type QuoteState = {
  inputAmountBaseUnits: string;
  requestId: string | null;
  route: ZeroExQuote;
};

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
const ETHEREUM_ONLY_CHAINS = SUPPORTED_CHAINS.filter((chain) => chain.id === 1);
const DEFAULT_SOURCE_TOKEN = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const DEFAULT_DESTINATION_TOKEN = getAddress("0x3898257dD2Cd6d2A3b6e3435f73568A725262b9B");
const DEFAULT_INPUT_TOKEN_ADDRESSES = new Set([
  DEFAULT_SOURCE_TOKEN.toLowerCase(),
  NATIVE_TOKEN_ADDRESS,
  getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7").toLowerCase(),
  getAddress("0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d").toLowerCase()
]);
const QUOTE_REFRESH_INTERVAL_MS = 30_000;
const INPUT_TOKEN_OPTIONS = ETHEREUM_TOKENS.filter(
  (token) => DEFAULT_INPUT_TOKEN_ADDRESSES.has(token.address.toLowerCase())
);
const OUTPUT_TOKEN_OPTIONS = ETHEREUM_TOKENS.filter(
  (token) => token.address.toLowerCase() === DEFAULT_DESTINATION_TOKEN.toLowerCase()
);

function getDefaultToken(address: string) {
  return (
    ETHEREUM_TOKENS.find(
      (token) => token.address.toLowerCase() === address.toLowerCase()
    ) ?? ETHEREUM_TOKENS[0]
  );
}

function getTokenIconUrl(address: string) {
  if (address.toLowerCase() === NATIVE_TOKEN_ADDRESS) {
    return "https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains/ethereum/info/logo.png";
  }

  return `https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains/ethereum/assets/${getAddress(address)}/logo.png`;
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
function TokenIcon({
  address,
  logoURI,
  symbol
}: {
  address: string;
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
      src={logoURI || getTokenIconUrl(address)}
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
                  token.address.toLowerCase() === selectedToken.address.toLowerCase()
                    ? " bw-token-option-active"
                    : ""
                }`}
                key={token.address}
                onClick={() => {
                  onSelect(token);
                  setIsOpen(false);
                }}
                type="button"
              >
                <span className="bw-token-option-main">
                  <TokenIcon
                    address={token.address}
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
  const [sourceChainId, setSourceChainId] = useState(1);
  const [destinationChainId, setDestinationChainId] = useState(1);
  const [inputToken, setInputToken] = useState<TokenOption>(() =>
    getDefaultToken(DEFAULT_SOURCE_TOKEN)
  );
  const [outputToken, setOutputToken] = useState<TokenOption>(() =>
    getDefaultToken(DEFAULT_DESTINATION_TOKEN)
  );
  const [amount, setAmount] = useState("1");
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [sourceTxHash, setSourceTxHash] = useState<string | null>(null);
  const [quoteLastUpdatedAt, setQuoteLastUpdatedAt] = useState<number | null>(null);
  const [quoteRefreshLabel, setQuoteRefreshLabel] = useState<string | null>(null);
  const [inputTokenBalanceLabel, setInputTokenBalanceLabel] = useState<string | null>(null);

  useEffect(() => {
    if (sourceChainId !== 1) {
      setSourceChainId(1);
    }
    if (destinationChainId !== 1) {
      setDestinationChainId(1);
    }
  }, [destinationChainId, sourceChainId]);

  useEffect(() => {
    let isActive = true;

    const loadInputTokenBalance = async () => {
      if (!wallet.address) {
        setInputTokenBalanceLabel(null);
        return;
      }

      try {
        const publicClient = wallet.getPublicClient(sourceChainId);
        const rawBalance =
          inputToken.address.toLowerCase() === NATIVE_TOKEN_ADDRESS
            ? await publicClient.getBalance({
                address: wallet.address as Address
              })
            : await publicClient.readContract({
                address: inputToken.address as Address,
                abi: ERC20_BALANCE_ABI,
                functionName: "balanceOf",
                args: [wallet.address as Address]
              });

        if (!isActive) {
          return;
        }

        setInputTokenBalanceLabel(
          `Balance: ${formatTokenAmount(rawBalance.toString(), inputToken.decimals)} ${inputToken.symbol}`
        );
      } catch {
        if (!isActive) {
          return;
        }

        setInputTokenBalanceLabel(null);
      }
    };

    void loadInputTokenBalance();

    return () => {
      isActive = false;
    };
  }, [inputToken.address, inputToken.decimals, inputToken.symbol, sourceChainId, wallet]);

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

    const publicClient = wallet.getPublicClient(sourceChainId);
    const walletClient = wallet.getWalletClient(sourceChainId);
    const spender =
      quoteRoute.issues?.allowance?.spender || quoteRoute.allowanceTarget;
    const approvalAmount = quoteRoute.sellAmount ?? fallbackSellAmount;

    if (!spender || !approvalAmount) {
      return;
    }

    const currentAllowance = await publicClient.readContract({
      address: inputToken.address as Address,
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
      to: inputToken.address as Address,
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

  const estimatedOutput = quote?.route.buyAmount;
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
            <h1>Buy $MBTC Here</h1>
          </div>
          <div className="bw-badges">
            <span className="bw-badge">{ZEROX_ENVIRONMENT_LABEL}</span>
            <span className="bw-badge bw-badge-accent">
              {wallet.shortAddress ?? "Wallet disconnected"}
            </span>
          </div>
        </div>

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
            <select disabled value={sourceChainId}>
              {ETHEREUM_ONLY_CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>

          <label className="bw-field">
            <span>Destination chain</span>
            <select disabled value={destinationChainId}>
              {ETHEREUM_ONLY_CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>

          <div className="bw-field bw-field-full">
            <TokenPicker
              label="Input token"
              onSelect={(token) => {
                setInputToken(token);
                setQuote(null);
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
              }}
              options={OUTPUT_TOKEN_OPTIONS}
              selectedToken={outputToken}
            />
          </div>

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
          <div className="bw-summary-row">
            <span>Time estimate</span>
            <strong>{quote ? "Ethereum confirmation" : "Unavailable"}</strong>
          </div>
          <div className="bw-summary-row">
            <span>Tx status</span>
            <strong>{swapStatus ?? "Idle"}</strong>
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

        {sourceTxHash ? (
          <p className="bw-footnote">Source tx: {sourceTxHash}</p>
        ) : null}

        {quoteError ? <p className="bw-error">{quoteError}</p> : null}
      </div>
    </div>
  );
}
