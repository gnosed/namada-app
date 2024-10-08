import { BuiltTx, EncodedTx } from "@heliax/namada-sdk/web";
import { getIntegration } from "@namada/integrations";
import {
  Account,
  AccountType,
  Signer,
  WrapperTxMsgValue,
  WrapperTxProps,
} from "@namada/types";
import { getIndexerApi } from "atoms/api";
import { chainParametersAtom } from "atoms/chain";
import { getSdkInstance } from "hooks";
import invariant from "invariant";
import { getDefaultStore } from "jotai";
import { Address, ChainSettings, GasConfig } from "types";
import { TransactionEventsClasses } from "types/events";

export type TransactionPair<T> = {
  encodedTxData: EncodedTxData<T>;
  signedTxs: Uint8Array[];
};

export type EncodedTxData<T> = {
  type: string;
  txs: BuiltTx[];
  wrapperTxMsg: Uint8Array;
  meta?: {
    props: T[];
  };
};

export type TransactionNotification = {
  success?: { title: string; text: string };
  error?: { title: string; text: string };
};

export type PreparedTransaction<T> = {
  encodedTx: EncodedTx;
  signedTx: Uint8Array;
  meta: T;
};

export const revealPublicKeyType = "revealPublicKey";

const getTxProps = (
  account: Account,
  gasConfig: GasConfig,
  chain: ChainSettings
): WrapperTxMsgValue => {
  invariant(
    !!account.publicKey,
    "Account doesn't contain a publicKey attached to it"
  );

  return {
    token: chain.nativeTokenAddress,
    feeAmount: gasConfig.gasPrice,
    gasLimit: gasConfig.gasLimit,
    chainId: chain.chainId,
    publicKey: account.publicKey!,
    memo: "",
  };
};

const isPublicKeyRevealed = async (address: Address): Promise<boolean> => {
  const api = getIndexerApi();
  let publicKey: string | undefined;
  try {
    publicKey = (await api.apiV1RevealedPublicKeyAddressGet(address)).data
      ?.publicKey;
  } catch (err) {}
  return Boolean(publicKey);
};

/**
 * Builds an batch  transactions based on the provided query properties.
 * Each transaction is built through the provided transaction function `txFn`.
 * @param {T[]} queryProps - An array of properties used to build transactions.
 * @param {(WrapperTxProps, T) => Promise<EncodedTx>} txFn - Function to build each transaction.
 */
export const buildTx = async <T>(
  account: Account,
  gasConfig: GasConfig,
  chain: ChainSettings,
  queryProps: T[],
  txFn: (wrapperTxProps: WrapperTxProps, props: T) => Promise<EncodedTx>
): Promise<EncodedTxData<T>> => {
  const { tx } = await getSdkInstance();
  const wrapperTxProps = getTxProps(account, gasConfig, chain);
  const txs: EncodedTx[] = [];
  const builtTxs: BuiltTx[] = [];

  // Determine if RevealPK is needed:
  const publicKeyRevealed = await isPublicKeyRevealed(account.address);
  if (!publicKeyRevealed) {
    const revealPkTx = await tx.buildRevealPk(wrapperTxProps);
    txs.push(revealPkTx);
  }

  const encodedTxs = await Promise.all(
    queryProps.map((props) => txFn.apply(tx, [wrapperTxProps, props]))
  );

  txs.push(...encodedTxs);

  if (account.type === AccountType.Ledger) {
    builtTxs.push(...txs.map(({ tx }) => tx));
  } else {
    builtTxs.push(tx.buildBatch(txs.map(({ tx }) => tx)));
  }

  return {
    txs: builtTxs,
    wrapperTxMsg: tx.encodeTxArgs(wrapperTxProps),
    type: txFn.name,
    meta: {
      props: queryProps,
    },
  };
};

/**
 * Asynchronously signs an encoded batch transaction using Namada extension.
 */
export const signTx = async <T>(
  chain: ChainSettings,
  typedEncodedTx: EncodedTxData<T>,
  owner: string
): Promise<Uint8Array[]> => {
  const integration = getIntegration(chain.id);
  const signingClient = integration.signer() as Signer;

  const store = getDefaultStore();
  const { data: chainParameters } = store.get(chainParametersAtom);
  const checksums = chainParameters?.checksums;

  try {
    // Sign txs
    const signedTxBytes = await signingClient.sign(
      typedEncodedTx.txs.map((builtTx) => ({
        txBytes: builtTx.tx_bytes(),
        signingDataBytes: builtTx.signing_data_bytes(),
      })),
      owner,
      checksums
    );

    if (!signedTxBytes) {
      throw new Error("Signing batch Tx failed");
    }

    return signedTxBytes;
  } catch (err) {
    const message = err instanceof Error ? err.message : err;
    throw new Error("Signing failed: " + message);
  }
};

/**
 * Builds an array of **transaction pairs**. Each transaction pair consists of a signed
 * transaction and its corresponding encoded transaction data.
 *
 * Encoded transaction data includes the transaction itself along with additional metadata
 * that holds the initial values used for its creation.
 */
export const buildTxPair = async <T>(
  account: Account,
  gasConfig: GasConfig,
  chain: ChainSettings,
  queryProps: T[],
  txFn: (wrapperTxProps: WrapperTxProps, props: T) => Promise<EncodedTx>,
  owner: string
): Promise<TransactionPair<T>> => {
  const encodedTxData = await buildTx<T>(
    account,
    gasConfig,
    chain,
    queryProps,
    txFn
  );
  const signedTxs = await signTx<T>(chain, encodedTxData, owner);
  return {
    signedTxs,
    encodedTxData,
  };
};

export const broadcastTx = async <T>(
  encodedTx: EncodedTxData<T>,
  signedTx: Uint8Array,
  data?: T[],
  eventType?: TransactionEventsClasses
): Promise<void> => {
  const { rpc } = await getSdkInstance();

  encodedTx.txs.forEach(async (tx) => {
    eventType &&
      window.dispatchEvent(
        new CustomEvent(`${eventType}.Pending`, {
          detail: { tx, data },
        })
      );
    try {
      // TODO: rpc.broadcastTx returns a TxResponseProps object now, containing hashes and
      // applied status of each commitment
      await rpc.broadcastTx({
        wrapperTxMsg: encodedTx.wrapperTxMsg,
        tx: signedTx,
      });
      eventType &&
        window.dispatchEvent(
          new CustomEvent(`${eventType}.Success`, {
            detail: { tx, data },
          })
        );
    } catch (error) {
      eventType &&
        window.dispatchEvent(
          new CustomEvent(`${eventType}.Error`, {
            detail: { tx, data, error },
          })
        );
    }
  });
};
