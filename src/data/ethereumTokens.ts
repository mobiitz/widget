export type TokenOption = {
  address: string;
  decimals: number;
  logoURI?: string;
  name: string;
  symbol: string;
};

const MBTC_LOGO_DATA_URI =
  "data:image/webp;base64,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";

export const ETHEREUM_TOKENS: TokenOption[] = [
  {
    address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    decimals: 18,
    name: "Ether",
    symbol: "ETH"
  },
  {
    address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
    decimals: 18,
    name: "Wrapped Ether",
    symbol: "WETH"
  },
  {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    name: "USD Coin",
    symbol: "USDC"
  },
  {
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
    name: "Tether USD",
    symbol: "USDT"
  },
  {
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    decimals: 18,
    name: "Dai Stablecoin",
    symbol: "DAI"
  },
  {
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    decimals: 8,
    name: "Wrapped BTC",
    symbol: "WBTC"
  },
  {
    address: "0x3898257dD2Cd6d2A3b6e3435f73568A725262b9B",
    decimals: 18,
    logoURI: MBTC_LOGO_DATA_URI,
    name: "MAGA Bitcoin",
    symbol: "MBTC"
  },
  {
    address: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    decimals: 18,
    name: "Chainlink",
    symbol: "LINK"
  },
  {
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    decimals: 18,
    name: "Uniswap",
    symbol: "UNI"
  },
  {
    address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDAE9",
    decimals: 18,
    name: "Aave",
    symbol: "AAVE"
  },
  {
    address: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",
    decimals: 18,
    name: "Maker",
    symbol: "MKR"
  },
  {
    address: "0xc00e94Cb662C3520282E6f5717214004A7f26888",
    decimals: 18,
    name: "Compound",
    symbol: "COMP"
  },
  {
    address: "0xD533a949740bb3306d119CC777fa900bA034cd52",
    decimals: 18,
    name: "Curve DAO Token",
    symbol: "CRV"
  },
  {
    address: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",
    decimals: 18,
    name: "Lido DAO",
    symbol: "LDO"
  },
  {
    address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
    decimals: 18,
    name: "Lido Staked Ether",
    symbol: "stETH"
  },
  {
    address: "0xae78736Cd615f374D3085123A210448E74Fc6393",
    decimals: 18,
    name: "Rocket Pool ETH",
    symbol: "rETH"
  },
  {
    address: "0x853d955aCEf822Db058eb8505911ED77F175b99e",
    decimals: 18,
    name: "Frax",
    symbol: "FRAX"
  },
  {
    address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE",
    decimals: 18,
    name: "Shiba Inu",
    symbol: "SHIB"
  },
  {
    address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    decimals: 18,
    name: "Pepe",
    symbol: "PEPE"
  },
  {
    address: "0x4d224452801ACEd8B2F0aebE155379bb5D594381",
    decimals: 18,
    name: "ApeCoin",
    symbol: "APE"
  },
  {
    address: "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72",
    decimals: 18,
    name: "Ethereum Name Service",
    symbol: "ENS"
  },
  {
    address: "0x0D8775F648430679A709E98d2b0Cb6250d2887EF",
    decimals: 18,
    name: "Basic Attention Token",
    symbol: "BAT"
  },
  {
    address: "0x111111111117dC0aa78b770fA6A738034120C302",
    decimals: 18,
    name: "1inch",
    symbol: "1INCH"
  },
  {
    address: "0xC011A73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F",
    decimals: 18,
    name: "Synthetix",
    symbol: "SNX"
  },
  {
    address: "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e",
    decimals: 18,
    name: "yearn.finance",
    symbol: "YFI"
  },
  {
    address: "0xBBbbCA6A901c926F240b89EacB641d8Aec7AEafD",
    decimals: 18,
    name: "Loopring",
    symbol: "LRC"
  },
  {
    address: "0x0F5D2fB29fb7d3CFeE444a200298f468908cC942",
    decimals: 18,
    name: "Decentraland",
    symbol: "MANA"
  },
  {
    address: "0x3845badAde8e6dFF049820680d1F14bD3903a5d0",
    decimals: 18,
    name: "The Sandbox",
    symbol: "SAND"
  }
];
