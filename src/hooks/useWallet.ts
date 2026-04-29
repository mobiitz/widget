import { useEffect, useRef, useState } from "react";
import type { Address, Chain, Hex } from "viem";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { arbitrum, base, bsc, mainnet, optimism, polygon } from "viem/chains";

type ProviderRequest = {
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

export type WalletId = "metamask" | "coinbase" | "uniswap";

export type EthereumProvider = {
  isCoinbaseWallet?: boolean;
  isMetaMask?: boolean;
  isUniswapExtension?: boolean;
  isUniswapWallet?: boolean;
  on?: (eventName: string, listener: (...args: unknown[]) => void) => void;
  providers?: EthereumProvider[];
  removeListener?: (
    eventName: string,
    listener: (...args: unknown[]) => void
  ) => void;
  request: (request: ProviderRequest) => Promise<unknown>;
};

type SendTransactionParams = {
  data?: Hex;
  gas?: bigint;
  gasPrice?: bigint;
  to: Address;
  value?: bigint;
};

type WindowWithWallet = Window & {
  ethereum?: EthereumProvider;
};

type EIP6963ProviderInfo = {
  icon?: string;
  name: string;
  rdns: string;
  uuid: string;
};

type EIP6963ProviderDetail = {
  info: EIP6963ProviderInfo;
  provider: EthereumProvider;
};

export type WalletOption = {
  id: WalletId;
  info?: EIP6963ProviderInfo;
  installed: boolean;
  label: string;
  provider: EthereumProvider | null;
  source: "eip6963" | "legacy" | "none";
};

export type SupportedChain = {
  id: number;
  name: string;
  nativeCurrency: Chain["nativeCurrency"];
  rpcUrl: string;
  blockExplorerUrl: string;
  viemChain: Chain;
};

export const NATIVE_TOKEN_ADDRESS =
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const chainCatalog = [mainnet, optimism, arbitrum, base, polygon, bsc];

const WALLET_LABELS: Record<WalletId, string> = {
  coinbase: "Coinbase Wallet",
  metamask: "MetaMask",
  uniswap: "Uniswap Extension"
};

export const SUPPORTED_CHAINS: SupportedChain[] = chainCatalog.map((chain) => ({
  id: chain.id,
  name: chain.name,
  nativeCurrency: chain.nativeCurrency,
  rpcUrl: chain.rpcUrls.default.http[0],
  blockExplorerUrl: chain.blockExplorers?.default.url ?? "",
  viemChain: chain
}));

export function findSupportedChain(chainId: number) {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId);
}

function getWindowWallet() {
  return window as WindowWithWallet;
}

function getDefaultWalletOptions() {
  return (Object.entries(WALLET_LABELS) as Array<[WalletId, string]>).map(
    ([id, label]) => ({
      id,
      installed: false,
      label,
      provider: null,
      source: "none" as const
    })
  );
}

function normalizeChainId(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.startsWith("0x")
      ? Number.parseInt(value, 16)
      : Number.parseInt(value, 10);
  }

  return null;
}

function shortenAddress(address: string | null) {
  if (!address) {
    return null;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toHexQuantity(value: bigint) {
  return `0x${value.toString(16)}`;
}

function includesNormalized(value: string | undefined, fragment: string) {
  return value?.toLowerCase().includes(fragment) ?? false;
}

function identifyWallet(
  provider: EthereumProvider,
  info?: EIP6963ProviderInfo
): WalletId | null {
  if (
    includesNormalized(info?.name, "coinbase") ||
    includesNormalized(info?.rdns, "coinbase") ||
    provider.isCoinbaseWallet
  ) {
    return "coinbase";
  }

  if (
    includesNormalized(info?.name, "uniswap") ||
    includesNormalized(info?.rdns, "uniswap") ||
    provider.isUniswapExtension ||
    provider.isUniswapWallet
  ) {
    return "uniswap";
  }

  if (
    includesNormalized(info?.name, "metamask") ||
    includesNormalized(info?.rdns, "metamask") ||
    provider.isMetaMask
  ) {
    return "metamask";
  }

  return null;
}

function buildWalletList(discovered: Partial<Record<WalletId, WalletOption>>) {
  return getDefaultWalletOptions().map(
    (wallet) => discovered[wallet.id] ?? wallet
  );
}

export function useWallet() {
  const [wallets, setWallets] = useState<WalletOption[]>(getDefaultWalletOptions);
  const [selectedWalletId, setSelectedWalletId] = useState<WalletId>("metamask");
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSwitchAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    const discovered: Partial<Record<WalletId, WalletOption>> = {};

    const publish = () => {
      const nextWallets = buildWalletList(discovered);
      const firstInstalledWallet = nextWallets.find((wallet) => wallet.installed);

      setWallets(nextWallets);
      setSelectedWalletId((currentWalletId) => {
        if (nextWallets.some((wallet) => wallet.id === currentWalletId && wallet.installed)) {
          return currentWalletId;
        }

        return firstInstalledWallet?.id ?? currentWalletId;
      });
    };

    const registerCandidate = (
      provider: EthereumProvider,
      source: "eip6963" | "legacy",
      info?: EIP6963ProviderInfo
    ) => {
      const walletId = identifyWallet(provider, info);

      if (!walletId) {
        return;
      }

      const currentWallet = discovered[walletId];
      const shouldReplace =
        !currentWallet ||
        (currentWallet.source === "legacy" && source === "eip6963") ||
        (!currentWallet.info && Boolean(info));

      if (!shouldReplace) {
        return;
      }

      discovered[walletId] = {
        id: walletId,
        info,
        installed: true,
        label: WALLET_LABELS[walletId],
        provider,
        source
      };

      publish();
    };

    const handleAnnounceProvider = (event: Event) => {
      const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
      if (!detail?.provider) {
        return;
      }

      registerCandidate(detail.provider, "eip6963", detail.info);
    };

    window.addEventListener(
      "eip6963:announceProvider",
      handleAnnounceProvider as EventListener
    );

    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const { ethereum } = getWindowWallet();
    if (ethereum?.providers?.length) {
      ethereum.providers.forEach((provider) => {
        registerCandidate(provider, "legacy");
      });
    }

    if (ethereum) {
      registerCandidate(ethereum, "legacy");
    }

    publish();

    return () => {
      window.removeEventListener(
        "eip6963:announceProvider",
        handleAnnounceProvider as EventListener
      );
    };
  }, []);

  const selectedWallet =
    wallets.find((wallet) => wallet.id === selectedWalletId) ?? null;

  useEffect(() => {
    const provider = selectedWallet?.provider;
    if (!provider) {
      setAddress(null);
      setChainId(null);
      setError(null);
      return;
    }

    let isActive = true;

    const syncState = async () => {
      try {
        const [accounts, currentChainId] = await Promise.all([
          provider.request({ method: "eth_accounts" }),
          provider.request({ method: "eth_chainId" })
        ]);

        if (!isActive) {
          return;
        }

        const nextAddress = Array.isArray(accounts) ? accounts[0] : null;
        setAddress(
          isDisconnected ? null : typeof nextAddress === "string" ? nextAddress : null
        );
        setChainId(normalizeChainId(currentChainId));
        setError(null);
      } catch (caughtError) {
        if (!isActive) {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to read the connected wallet state."
        );
      }
    };

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAddress = Array.isArray(accounts) ? accounts[0] : null;
      if (typeof nextAddress === "string") {
        setIsDisconnected(false);
      }
      setAddress(
        isDisconnected ? null : typeof nextAddress === "string" ? nextAddress : null
      );
    };

    const handleChainChanged = (nextChainId: unknown) => {
      setChainId(normalizeChainId(nextChainId));
    };

    void syncState();
    provider.on?.("accountsChanged", handleAccountsChanged);
    provider.on?.("chainChanged", handleChainChanged);

    return () => {
      isActive = false;
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [isDisconnected, selectedWallet]);

  const connect = async (walletId = selectedWalletId) => {
    const wallet = wallets.find((candidate) => candidate.id === walletId) ?? null;
    if (!wallet?.provider) {
      throw new Error(`${WALLET_LABELS[walletId]} was not detected in this browser.`);
    }

    setSelectedWalletId(walletId);
    setIsConnecting(true);
    setIsDisconnected(false);
    setError(null);

    try {
      const accounts = await wallet.provider.request({
        method: "eth_requestAccounts"
      });
      const nextAddress = Array.isArray(accounts) ? accounts[0] : null;
      const normalizedAddress =
        typeof nextAddress === "string" ? nextAddress : null;

      let currentChainId = normalizeChainId(
        await wallet.provider.request({
          method: "eth_chainId"
        })
      );

      if (currentChainId !== 1) {
        const ethereumChain = findSupportedChain(1);

        if (!ethereumChain) {
          throw new Error("Ethereum network configuration is unavailable.");
        }

        try {
          await wallet.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x1" }]
          });
          currentChainId = 1;
        } catch (caughtError) {
          const errorCode =
            typeof caughtError === "object" &&
            caughtError !== null &&
            "code" in caughtError
              ? Number((caughtError as { code?: unknown }).code)
              : undefined;

          if (errorCode === 4902) {
            await wallet.provider.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0x1",
                  chainName: ethereumChain.name,
                  nativeCurrency: ethereumChain.nativeCurrency,
                  rpcUrls: [ethereumChain.rpcUrl],
                  blockExplorerUrls: ethereumChain.blockExplorerUrl
                    ? [ethereumChain.blockExplorerUrl]
                    : []
                }
              ]
            });
            currentChainId = 1;
          } else {
            throw caughtError instanceof Error
              ? caughtError
              : new Error("Failed to switch to Ethereum.");
          }
        }
      }

      setAddress(normalizedAddress);
      setChainId(currentChainId);
      setError(null);
      autoSwitchAttemptRef.current = null;
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : `Failed to connect ${wallet.label}.`;
      setError(message);
      throw new Error(message);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setIsDisconnected(true);
    setAddress(null);
    setError(null);
  };

  const switchToChain = async (targetChainId: number) => {
    const provider = selectedWallet?.provider;
    const chain = findSupportedChain(targetChainId);

    if (!provider || !selectedWallet) {
      throw new Error("No wallet is selected.");
    }

    if (!chain) {
      throw new Error(`Unsupported chain: ${targetChainId}`);
    }

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${targetChainId.toString(16)}` }]
      });
      setChainId(targetChainId);
    } catch (caughtError) {
      const errorCode =
        typeof caughtError === "object" &&
        caughtError !== null &&
        "code" in caughtError
          ? Number((caughtError as { code?: unknown }).code)
          : undefined;

      if (errorCode !== 4902) {
        throw caughtError instanceof Error
          ? caughtError
          : new Error(`Failed to switch ${selectedWallet.label}.`);
      }

      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${targetChainId.toString(16)}`,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [chain.rpcUrl],
            blockExplorerUrls: chain.blockExplorerUrl
              ? [chain.blockExplorerUrl]
              : []
          }
        ]
      });

      setChainId(targetChainId);
    }
  };

  useEffect(() => {
    if (!address || !selectedWallet || isDisconnected || chainId === null || chainId === 1) {
      return;
    }

    const attemptKey = `${selectedWallet.id}:${address}:${chainId}`;
    if (autoSwitchAttemptRef.current === attemptKey) {
      return;
    }

    autoSwitchAttemptRef.current = attemptKey;

    void switchToChain(1).catch((caughtError) => {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Please switch to Ethereum to use this widget."
      );
    });
  }, [address, chainId, isDisconnected, selectedWallet]);

  const getWalletClient = (targetChainId: number) => {
    const provider = selectedWallet?.provider;
    const chain = findSupportedChain(targetChainId);

    if (!provider || !chain || !address) {
      throw new Error("Wallet is not connected.");
    }

    return createWalletClient({
      account: address as Address,
      chain: chain.viemChain,
      transport: custom(provider)
    });
  };

  const getPublicClient = (targetChainId: number) => {
    const chain = findSupportedChain(targetChainId);
    if (!chain) {
      throw new Error(`Unsupported chain: ${targetChainId}`);
    }

    return createPublicClient({
      chain: chain.viemChain,
      transport: http(chain.rpcUrl)
    });
  };

  const sendTransaction = async (
    targetChainId: number,
    transaction: SendTransactionParams
  ) => {
    const provider = selectedWallet?.provider;

    if (!provider || !address) {
      throw new Error("Wallet is not connected.");
    }

    const chain = findSupportedChain(targetChainId);
    if (!chain) {
      throw new Error(`Unsupported chain: ${targetChainId}`);
    }

    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: address,
          to: transaction.to,
          data: transaction.data ?? "0x",
          value:
            transaction.value !== undefined
              ? toHexQuantity(transaction.value)
              : undefined,
          gas:
            transaction.gas !== undefined
              ? toHexQuantity(transaction.gas)
              : undefined,
          gasPrice:
            transaction.gasPrice !== undefined
              ? toHexQuantity(transaction.gasPrice)
              : undefined,
          chainId: `0x${chain.id.toString(16)}`
        }
      ]
    });

    if (typeof hash !== "string") {
      throw new Error("Wallet did not return a transaction hash.");
    }

    return hash as Hex;
  };

  return {
    address,
    chainId,
    error,
    hasProvider: wallets.some((wallet) => wallet.installed),
    isDisconnected,
    isConnecting,
    isConnected: Boolean(address) && !isDisconnected,
    selectedWallet,
    selectedWalletId,
    shortAddress: shortenAddress(address),
    wallets,
    connect,
    disconnect,
    getPublicClient,
    getWalletClient,
    selectWallet: setSelectedWalletId,
    sendTransaction,
    switchToChain
  };
}
