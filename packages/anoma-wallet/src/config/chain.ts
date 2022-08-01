import { Network } from "./rpc";

export type Protocol = "http" | "https" | "ws" | "wss";

const {
  // Default local ledger config
  REACT_APP_LEDGER_URL,
  REACT_APP_LEDGER_PORT,
  REACT_APP_CHAIN_ID,
  REACT_APP_FAUCET,
  REACT_APP_ALIAS,
  // Alternatively, specify a local IBC chain:
  // IBC - CHAIN A
  REACT_APP_CHAIN_A_ALIAS,
  REACT_APP_CHAIN_A_ID,
  REACT_APP_CHAIN_A_URL,
  REACT_APP_CHAIN_A_PORT,
  REACT_APP_CHAIN_A_FAUCET,
  REACT_APP_CHAIN_A_PORT_ID,
  REACT_APP_CHAIN_A_CHANNEL,
  // IBC - CHAIN B
  REACT_APP_CHAIN_B_ALIAS,
  REACT_APP_CHAIN_B_ID,
  REACT_APP_CHAIN_B_URL,
  REACT_APP_CHAIN_B_PORT,
  REACT_APP_CHAIN_B_FAUCET,
  REACT_APP_CHAIN_B_PORT_ID,
  REACT_APP_CHAIN_B_CHANNEL,
} = process.env;

export type NetworkConfig = Network & {
  wsProtocol: Protocol;
};

export type IBCConfig = {
  chainId: string; // Destination chainId
  defaultChannel: string; // Default channel which connects source chain to destination
};

export type Chain = {
  id: string;
  alias: string;
  accountIndex: number;
  network: NetworkConfig;
  faucet?: string;
  portId?: string;
  ibc?: IBCConfig[];
};

const DEFAULT_URL = "127.0.0.1";
const DEFAULT_CHAIN_ALIAS = "Namada";
const DEFAULT_IBC_PORT = "transfer";
const DEFAULT_IBC_CHANNEL = "channel-0";

/**
 * Remove any comments ("#") or quotes
 * @param url
 * @returns {string}
 */
const stripInvalidCharacters = (url = ""): string => {
  // Ignore comments and quotes
  return url.split("#")[0].replace(/\"|\'/, "");
};

/**
 * Remove any characters after whitespace from env value
 * @param value
 * @returns {string}
 */
const sanitize = (value = " "): string => {
  return stripInvalidCharacters(value).split(" ")[0];
};

/**
 * Return URL with no prefixed protocol
 * @param url
 * @returns {string}
 */
const getUrl = (url = ""): string => {
  return sanitize(url).replace(/^https?\:\/\//, "");
};

/**
 * Get the protocol from a URL or return default
 * @param url
 * @returns {Protocol}
 */
const getUrlProtocol = (url?: string): Protocol => {
  const prefix = sanitize(url).split(":")[0];

  if (prefix === "https") {
    return "https";
  }

  return "http";
};

/**
 * The .env can currently provide configurations for up to 3 chains:
 *  - A default chain (No-IBC), and/or:
 *  - IBC-enabled chain 1
 *    - This chain will only provide IBC functionality if Chain 2 is defined,
 *      otherwise will behave as a non-IBC chain
 *  - IBC-enabled chain 2
 *    - This will only be loaded if Chain 1 is also defined.
 *
 * NOTE: IBC functionality will only be displayed where Chain 1 and Chain 2 exist,
 * and will automatically include a reference to the other capable chain in it's config,
 * so the user will see a destination chain.
 */

// Default chain
const chainId = sanitize(REACT_APP_CHAIN_ID);
const alias = stripInvalidCharacters(REACT_APP_ALIAS) || DEFAULT_CHAIN_ALIAS;
const url = getUrl(sanitize(REACT_APP_LEDGER_URL));
const protocol = getUrlProtocol(REACT_APP_LEDGER_URL);
const wsProtocol: Protocol = protocol === "https" ? "wss" : "ws";
const faucet = sanitize(REACT_APP_FAUCET);
const port = parseInt(sanitize(REACT_APP_LEDGER_PORT)) || undefined;

// IBC Chain A
const chainAId = sanitize(REACT_APP_CHAIN_A_ID);
const chainAAlias =
  stripInvalidCharacters(REACT_APP_CHAIN_A_ALIAS) || "IBC - 1";
const chainAUrl = getUrl(REACT_APP_CHAIN_A_URL) || DEFAULT_URL;
const chainAPort = parseInt(sanitize(REACT_APP_CHAIN_A_PORT)) || undefined;
const chainAProtocol = getUrlProtocol(REACT_APP_CHAIN_A_URL);
const chainAWsProtocol: Protocol = chainAProtocol === "https" ? "wss" : "ws";
const chainAPortId = sanitize(REACT_APP_CHAIN_A_PORT_ID) || DEFAULT_IBC_PORT;
const chainAChannelId =
  sanitize(REACT_APP_CHAIN_A_CHANNEL) || DEFAULT_IBC_CHANNEL;
const chainAFaucet = sanitize(REACT_APP_CHAIN_A_FAUCET) || undefined;

// IBC Chain B
const chainBId = sanitize(REACT_APP_CHAIN_B_ID);
const chainBAlias =
  stripInvalidCharacters(REACT_APP_CHAIN_B_ALIAS) || "IBC - 1";
const chainBUrl = getUrl(REACT_APP_CHAIN_B_URL) || DEFAULT_URL;
const chainBPort = parseInt(sanitize(REACT_APP_CHAIN_B_PORT)) || undefined;
const chainBProtocol = getUrlProtocol(REACT_APP_CHAIN_B_URL);
const chainBWsProtocol: Protocol = chainBProtocol === "https" ? "wss" : "ws";
const chainBPortId = sanitize(REACT_APP_CHAIN_B_PORT_ID) || DEFAULT_IBC_PORT;
const chainBFaucet = sanitize(REACT_APP_CHAIN_B_FAUCET) || undefined;
const chainBChannelId =
  sanitize(REACT_APP_CHAIN_B_CHANNEL) || DEFAULT_IBC_CHANNEL;

export const defaultChainId =
  chainId || chainAId || "anoma-test.fd58c789bc11e6c6392";

const chains: Chain[] = [];

if (chainId) {
  // If no IBC chains specified in .env, you MUST have a default chain config specified for Namada!
  chains.push({
    id: chainId || defaultChainId,
    alias,
    accountIndex: 0,
    faucet,
    network: {
      url: url || DEFAULT_URL,
      port,
      protocol,
      wsProtocol,
    },
  });
}

if (chainAId) {
  chains.push({
    id: chainAId,
    alias: chainAAlias,
    accountIndex: 998,
    faucet: chainAFaucet,
    portId: chainAPortId,
    network: {
      url: chainAUrl,
      port: chainAPort,
      protocol: chainAProtocol,
      wsProtocol: chainAWsProtocol,
    },
    ibc: chainBId
      ? [
          {
            chainId: chainBId,
            defaultChannel: chainBChannelId,
          },
        ]
      : undefined,
  });
}

if (chainAId && chainBId) {
  chains.push({
    id: chainBId,
    alias: chainBAlias,
    accountIndex: 999,
    faucet: chainBFaucet,
    portId: chainBPortId,
    network: {
      url: chainBUrl,
      port: chainBPort,
      protocol: chainBProtocol,
      wsProtocol: chainBWsProtocol,
    },
    ibc: [
      {
        chainId: chainAId,
        defaultChannel: chainAChannelId,
      },
    ],
  });
}

/**
 * TODO: Load ChainConfig from JSON.
 * This set-up only supports up to 3 chains (one default, two with IBC enabled),
 * loaded from .env
 */
const ChainConfig = chains.reduce(
  (config: Record<string, Chain>, chain: Chain) => {
    const chainId = chain.id;
    config[chainId] = chain;
    return config;
  },
  {}
);

export default ChainConfig;