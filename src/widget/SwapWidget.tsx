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
  isAddress,
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

type PublicClientGetter = ReturnType<typeof useWallet>["getPublicClient"];

type TokenPickerProps = {
  chainId: number;
  getPublicClient: PublicClientGetter;
  label: string;
  onSelect: (token: TokenOption) => void;
  options: TokenOption[];
  selectedToken: TokenOption;
};

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
]);
const ERC20_METADATA_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
]);
const ETHEREUM_ONLY_CHAINS = SUPPORTED_CHAINS.filter((chain) => chain.id === 1);
const CUSTOM_TOKEN_CACHE = new Map<string, TokenOption>();
const DEFAULT_SOURCE_TOKEN = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const DEFAULT_DESTINATION_TOKEN = getAddress("0x3898257dD2Cd6d2A3b6e3435f73568A725262b9B");
const REMOTE_ETHEREUM_TOKEN_LIST_URL =
  "https://raw.githubusercontent.com/viaprotocol/tokenlists/main/tokenlists/ethereum.json";

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

type RemoteTokenListEntry = {
  address: string;
  chainId: number;
  decimals: number;
  listedIn?: string[];
  logoURI?: string;
  name: string;
  symbol: string;
};

function mergeTokenOptions(...lists: TokenOption[][]) {
  const seen = new Map<string, TokenOption>();

  for (const list of lists) {
    for (const token of list) {
      const normalizedAddress = token.address.toLowerCase();
      if (!seen.has(normalizedAddress)) {
        seen.set(normalizedAddress, token);
      }
    }
  }

  return [...seen.values()];
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

function shortHash(hash: string | null) {
  if (!hash) {
    return null;
  }

  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

async function importTokenByAddress(
  chainId: number,
  address: string,
  getPublicClient: PublicClientGetter
) {
  const normalizedAddress = getAddress(address);
  const cacheKey = `${chainId}:${normalizedAddress.toLowerCase()}`;
  const cachedToken = CUSTOM_TOKEN_CACHE.get(cacheKey);

  if (cachedToken) {
    return cachedToken;
  }

  if (normalizedAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS) {
    return ETHEREUM_TOKENS[0];
  }

  const publicClient = getPublicClient(chainId);
  const [symbol, name, decimals] = await Promise.all([
    publicClient.readContract({
      address: normalizedAddress as Address,
      abi: ERC20_METADATA_ABI,
      functionName: "symbol"
    }),
    publicClient.readContract({
      address: normalizedAddress as Address,
      abi: ERC20_METADATA_ABI,
      functionName: "name"
    }),
    publicClient.readContract({
      address: normalizedAddress as Address,
      abi: ERC20_METADATA_ABI,
      functionName: "decimals"
    })
  ]);

  const token = {
    address: normalizedAddress,
    decimals: Number(decimals),
    name,
    symbol
  } satisfies TokenOption;

  CUSTOM_TOKEN_CACHE.set(cacheKey, token);
  return token;
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
  chainId,
  getPublicClient,
  label,
  onSelect,
  options,
  selectedToken
}: TokenPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setPickerError(null);
      setIsImporting(false);
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
    const candidateOptions = normalizedQuery
      ? options.filter((token) =>
          [token.symbol, token.name, token.address].some((value) =>
            value.toLowerCase().includes(normalizedQuery)
          )
        )
      : options;

    return candidateOptions.slice(0, 100);
  }, [deferredQuery, options]);

  const customImportAddress = useMemo(() => {
    if (!deferredQuery.trim() || !isAddress(deferredQuery.trim())) {
      return null;
    }

    const normalizedAddress = deferredQuery.trim().toLowerCase();
    const alreadyListed = options.some(
      (token) => token.address.toLowerCase() === normalizedAddress
    );

    return alreadyListed ? null : deferredQuery.trim();
  }, [deferredQuery, options]);

  const handleImport = async (address: string) => {
    setIsImporting(true);
    setPickerError(null);

    try {
      const importedToken = await importTokenByAddress(
        chainId,
        address,
        getPublicClient
      );
      onSelect(importedToken);
      setIsOpen(false);
    } catch (error) {
      setPickerError(
        error instanceof Error
          ? error.message
          : "Failed to import that token address."
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="bw-field" ref={containerRef}>
      <span>{label}</span>
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
              setPickerError(null);
            }}
            placeholder="Search symbol, name, or paste token address"
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

            {customImportAddress ? (
              <button
                className="bw-token-option bw-token-option-import"
                disabled={isImporting}
                onClick={() => {
                  void handleImport(customImportAddress);
                }}
                type="button"
              >
                <span className="bw-token-option-main">
                  <span className="bw-token-icon-fallback">0x</span>
                  <span className="bw-token-option-copy">
                    <strong>{isImporting ? "Importing token..." : "Use custom token"}</strong>
                    <small>{customImportAddress}</small>
                  </span>
                </span>
              </button>
            ) : null}
          </div>

          {pickerError ? <p className="bw-error bw-picker-error">{pickerError}</p> : null}
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
  const [catalogTokens, setCatalogTokens] = useState<TokenOption[]>([]);

  const tokenOptions = useMemo(
    () => mergeTokenOptions(ETHEREUM_TOKENS, catalogTokens, [inputToken, outputToken]),
    [catalogTokens, inputToken, outputToken]
  );

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

    const loadRemoteTokenCatalog = async () => {
      try {
        const response = await fetch(REMOTE_ETHEREUM_TOKEN_LIST_URL, {
          headers: {
            Accept: "application/json"
          }
        });

        if (!response.ok) {
          throw new Error(`Token catalog request failed with status ${response.status}.`);
        }

        const tokens = (await response.json()) as RemoteTokenListEntry[];
        const rankedTokens = tokens
          .filter((token) => token.chainId === 1 && isAddress(token.address))
          .sort((leftToken, rightToken) => {
            const sourceCountDelta =
              (rightToken.listedIn?.length ?? 0) - (leftToken.listedIn?.length ?? 0);

            if (sourceCountDelta !== 0) {
              return sourceCountDelta;
            }

            return leftToken.symbol.localeCompare(rightToken.symbol);
          })
          .map((token) => ({
            address: getAddress(token.address),
            decimals: token.decimals,
            logoURI: token.logoURI,
            name: token.name,
            symbol: token.symbol
          }));

        if (!isActive) {
          return;
        }

        setCatalogTokens(rankedTokens);
      } catch {
        if (!isActive) {
          return;
        }

        setCatalogTokens([]);
      }
    };

    void loadRemoteTokenCatalog();

    return () => {
      isActive = false;
    };
  }, []);

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
  const routeLabel = quote ? getRouteLabel(quote.route) : "Request a quote";
  const feeLabel = quote
    ? [
        quote.route.fees?.integratorFee?.amount
          ? `${formatTokenAmount(
              quote.route.fees.integratorFee.amount,
              inputToken.decimals
            )} ${inputToken.symbol}`
          : null,
        quote.route.totalNetworkFee
          ? `${formatTokenAmount(quote.route.totalNetworkFee, 18)} ETH network`
          : null
      ]
        .filter(Boolean)
        .join(" + ") || "Unavailable"
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
            <span className="bw-badge">{ZEROX_ENVIRONMENT_LABEL}</span>
            <span className="bw-badge bw-badge-accent">
              {wallet.shortAddress ?? "Wallet disconnected"}
            </span>
          </div>
        </div>

        <p className="bw-description">
          Swap Ethereum tokens with <code>USDC -&gt; MBTC</code> preselected.
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

          <TokenPicker
            chainId={sourceChainId}
            getPublicClient={wallet.getPublicClient}
            label="Input token"
            onSelect={(token) => {
              setInputToken(token);
              setQuote(null);
            }}
            options={tokenOptions}
            selectedToken={inputToken}
          />

          <TokenPicker
            chainId={destinationChainId}
            getPublicClient={wallet.getPublicClient}
            label="Output token"
            onSelect={(token) => {
              setOutputToken(token);
              setQuote(null);
            }}
            options={tokenOptions}
            selectedToken={outputToken}
          />

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
                    outputToken.decimals
                  )} ${outputToken.symbol}`.trim()
                : "Unavailable"}
            </strong>
          </div>
          <div className="bw-summary-row">
            <span>Fees</span>
            <strong>{feeLabel}</strong>
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
