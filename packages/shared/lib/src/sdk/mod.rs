mod args;
pub mod io;
pub mod masp;
mod signature;
mod transaction;
mod tx;
mod wallet;

use self::io::WebIo;
use crate::rpc_client::HttpClient;
use crate::utils::set_panic_hook;
#[cfg(feature = "web")]
use crate::utils::to_bytes;
use crate::utils::to_js_result;
use gloo_utils::format::JsValueSerdeExt;
use js_sys::Uint8Array;
use namada_sdk::address::Address;
use namada_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use namada_sdk::eth_bridge::bridge_pool::build_bridge_pool_tx;
use namada_sdk::hash::Hash;
use namada_sdk::key::{common, ed25519, SigScheme};
use namada_sdk::masp::ShieldedContext;
use namada_sdk::rpc::query_epoch;
use namada_sdk::signing::SigningTxData;
use namada_sdk::string_encoding::Format;
use namada_sdk::tx::Tx;
use namada_sdk::tx::{
    build_batch, build_bond, build_claim_rewards, build_ibc_transfer, build_redelegation,
    build_reveal_pk, build_transparent_transfer, build_unbond, build_vote_proposal, build_withdraw,
    is_reveal_pk_needed, process_tx, ProcessTxResponse,
};
use namada_sdk::wallet::{Store, Wallet};
use namada_sdk::{Namada, NamadaImpl};
use std::str::FromStr;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};

#[wasm_bindgen]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "namada_sdk::borsh")]
pub struct BatchTxResult {
    hash: String,
    is_applied: bool,
}

#[wasm_bindgen]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "namada_sdk::borsh")]
pub struct TxResponse {
    code: String,
    commitments: Vec<BatchTxResult>,
    gas_used: String,
    hash: String,
    height: String,
    info: String,
    log: String,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct BuiltTx {
    tx: Vec<u8>,
    signing_data: Vec<SigningTxData>,
}

#[wasm_bindgen]
impl BuiltTx {
    #[wasm_bindgen(constructor)]
    pub fn new(tx: Vec<u8>, signing_data_bytes: JsValue) -> Result<BuiltTx, JsError> {
        let signing_data_bytes: Vec<Vec<u8>> = signing_data_bytes
            .into_serde()
            .expect("Deserializing should not fail");

        let mut signing_data: Vec<SigningTxData> = vec![];

        for bytes in signing_data_bytes {
            let sd: tx::SigningData = borsh::from_slice(&bytes)?;
            let signing_tx_data: SigningTxData = sd.to_signing_tx_data()?;
            signing_data.push(signing_tx_data);
        }

        Ok(BuiltTx { tx, signing_data })
    }

    pub fn tx_bytes(&self) -> Vec<u8> {
        self.tx.clone()
    }

    pub fn tx_hash(&self) -> Result<JsValue, JsError> {
        let tx: Tx = borsh::from_slice(&self.tx_bytes())?;
        to_js_result(tx.header_hash().to_string())
    }

    pub fn signing_data_bytes(&self) -> Result<JsValue, JsError> {
        let mut signing_data_bytes: Vec<Vec<u8>> = vec![];

        for signing_tx_data in self.signing_data.clone() {
            let signing_data = tx::SigningData::from_signing_tx_data(signing_tx_data)?;
            let bytes = signing_data.to_bytes()?;
            signing_data_bytes.push(bytes);
        }

        Ok(JsValue::from_serde(&signing_data_bytes)?)
    }
}

/// Represents the Sdk public API.
#[wasm_bindgen]
pub struct Sdk {
    namada: NamadaImpl<HttpClient, wallet::JSWalletUtils, masp::JSShieldedUtils, WebIo>,
}

#[wasm_bindgen]
/// Sdk mostly wraps the logic of the Sdk struct members, making it a part of public API.
/// For more details, navigate to the corresponding modules.
impl Sdk {
    #[wasm_bindgen(constructor)]
    pub fn new(url: String, native_token: String, path_or_db_name: String) -> Self {
        set_panic_hook();
        let client: HttpClient = HttpClient::new(url);
        let wallet: Wallet<wallet::JSWalletUtils> = Wallet::new(
            wallet::JSWalletUtils::new_utils(&path_or_db_name),
            Store::default(),
        );
        let shielded_ctx: ShieldedContext<masp::JSShieldedUtils> = ShieldedContext::default();

        let namada = NamadaImpl::native_new(
            client,
            wallet,
            shielded_ctx,
            WebIo,
            //NAM address
            Address::from_str(&native_token).unwrap(),
        );

        Sdk { namada }
    }

    pub async fn has_masp_params() -> Result<JsValue, JsValue> {
        let has = has_masp_params().await?;

        Ok(js_sys::Boolean::from(has.as_bool().unwrap()).into())
    }

    pub async fn fetch_and_store_masp_params() -> Result<(), JsValue> {
        fetch_and_store_masp_params().await?;
        Ok(())
    }

    #[cfg(feature = "web")]
    pub async fn load_masp_params(&self, _db_name: JsValue) -> Result<(), JsValue> {
        // _dn_name is not used in the web version for a time being
        let params = get_masp_params().await?;
        let params_iter = js_sys::try_iter(&params)?.ok_or_else(|| "Can't iterate over JsValue")?;
        let mut params_bytes = params_iter.map(|p| to_bytes(p.unwrap()));

        let spend = params_bytes.next().unwrap();
        let output = params_bytes.next().unwrap();
        let convert = params_bytes.next().unwrap();

        // We are making sure that there are no more params left
        assert_eq!(params_bytes.next(), None);

        let mut shielded = self.namada.shielded_mut().await;
        *shielded = masp::JSShieldedUtils::new(spend, output, convert).await?;

        Ok(())
    }

    #[cfg(feature = "nodejs")]
    pub async fn load_masp_params(&self, context_dir: JsValue) -> Result<(), JsValue> {
        let context_dir = context_dir.as_string().unwrap();

        let mut shielded = self.namada.shielded_mut().await;
        *shielded = masp::JSShieldedUtils::new(&context_dir).await;

        Ok(())
    }

    pub async fn add_spending_key(&self, xsk: String, alias: String) {
        let mut wallet = self.namada.wallet_mut().await;
        wallet::add_spending_key(&mut wallet, xsk, alias)
    }

    pub async fn add_viewing_key(&self, xvk: String, alias: String) {
        let mut wallet = self.namada.wallet_mut().await;
        wallet::add_viewing_key(&mut wallet, xvk, alias)
    }

    pub async fn add_payment_address(&self, pa: String, alias: String) {
        let mut wallet = self.namada.wallet_mut().await;
        wallet::add_payment_address(&mut wallet, pa, alias)
    }

    pub async fn add_default_payment_address(&self, xvk: String, alias: String) {
        let mut wallet = self.namada.wallet_mut().await;
        wallet::add_default_payment_address(&mut wallet, xvk, alias)
    }

    pub async fn add_keypair(&self, secret_key: String, alias: String, password: Option<String>) {
        let mut wallet = self.namada.wallet_mut().await;
        wallet::add_keypair(&mut wallet, secret_key, alias, password)
    }

    pub async fn save_wallet(&self) -> Result<(), JsValue> {
        let wallet = self.namada.wallet_mut().await;
        wallet.save().map_err(JsError::from)?;

        Ok(())
    }

    pub async fn load_wallet(&self) -> Result<(), JsValue> {
        let mut wallet = self.namada.wallet_mut().await;
        wallet.load().map_err(JsError::from)?;

        Ok(())
    }

    pub async fn sign_tx(
        &self,
        built_tx: BuiltTx,
        private_key: Option<String>,
        chain_id: Option<String>,
    ) -> Result<JsValue, JsError> {
        let mut tx: Tx = borsh::from_slice(&built_tx.tx)?;

        // If chain_id is provided, validate this against value in Tx header
        if let Some(c) = chain_id {
            if c != tx.header.chain_id.to_string() {
                return Err(JsError::new(&format!(
                    "chain_id {} does not match Tx header chain_id {}",
                    &c,
                    tx.header.chain_id.as_str()
                )));
            }
        }

        let signing_keys = match private_key.clone() {
            Some(private_key) => vec![common::SecretKey::Ed25519(ed25519::SecretKey::from_str(
                &private_key,
            )?)],
            // If no private key is provided, we assume masp source and return empty vec
            None => vec![],
        };

        for signing_tx_data in built_tx.signing_data {
            if let Some(account_public_keys_map) = signing_tx_data.account_public_keys_map.clone() {
                // We only sign the raw header for transfers from transparent source
                if !signing_keys.is_empty() {
                    // Sign the raw header
                    tx.sign_raw(
                        signing_keys.clone(),
                        account_public_keys_map,
                        signing_tx_data.owner.clone(),
                    );
                }
            }
        }

        // The key is either passed private key for transparent sources or the disposable signing
        // key for shielded sources
        let key = signing_keys[0].clone();

        // Sign the fee header
        tx.sign_wrapper(key);

        to_js_result(borsh::to_vec(&tx)?)
    }

    // Broadcast Tx
    pub async fn process_tx(&self, tx_bytes: &[u8], tx_msg: &[u8]) -> Result<JsValue, JsError> {
        let args = args::tx_args_from_slice(tx_msg)?;

        let tx = Tx::try_from_slice(tx_bytes)?;
        let cmts = tx.commitments().clone();
        let hash = tx.header_hash().to_string();
        let resp = process_tx(&self.namada, &args, tx.clone()).await?;

        let mut batch_tx_results: Vec<BatchTxResult> = vec![];

        for cmt in cmts {
            let response = resp.is_applied_and_valid(Some(&tx.header_hash()), &cmt);
            let hash = cmt.get_hash().to_string();

            batch_tx_results.push(BatchTxResult {
                hash,
                is_applied: response.is_some(),
            });
        }

        // Collect results and return
        match resp {
            ProcessTxResponse::Applied(tx_response) => {
                let code = tx_response.code.to_string();
                let gas_used = tx_response.gas_used.to_string();
                let height = tx_response.height.to_string();
                let info = tx_response.info.to_string();
                let log = tx_response.log.to_string();

                let response = TxResponse {
                    code,
                    commitments: batch_tx_results,
                    gas_used,
                    hash,
                    height,
                    info,
                    log,
                };
                to_js_result(borsh::to_vec(&response)?)
            }
            _ => return Err(JsError::new(&format!("Tx not applied: {}", &hash))),
        }
    }

    /// Build a batch Tx from built transactions and return the bytes
    pub fn build_batch(built_txs: Vec<BuiltTx>) -> Result<BuiltTx, JsError> {
        let mut txs: Vec<(Tx, SigningTxData)> = vec![];

        // Iterate through provided BuiltTx and deserialize bytes to Tx
        for built_tx in built_txs.into_iter() {
            let tx: Tx = Tx::try_from_slice(&built_tx.tx_bytes())?;
            let first_signing_data = built_tx
                .signing_data
                .iter()
                .nth(0)
                .expect("At least one signing data should be present on a Tx");
            txs.push((tx, first_signing_data.to_owned()));
        }

        let (tx, signing_data) = build_batch(txs.clone())?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data,
        })
    }

    // Append signatures and return tx bytes
    pub fn append_signature(
        &self,
        tx_bytes: &[u8],
        sig_msg_bytes: &[u8],
    ) -> Result<JsValue, JsError> {
        let mut tx: Tx = Tx::try_from_slice(tx_bytes)?;
        let signature::SignatureMsg {
            pubkey,
            raw_indices,
            raw_signature,
            wrapper_indices,
            wrapper_signature,
        } = signature::SignatureMsg::try_from_slice(&sig_msg_bytes)?;

        let raw_sig_section =
            signature::construct_signature_section(&pubkey, &raw_indices, &raw_signature, &tx)?;
        tx.add_section(raw_sig_section);

        let wrapper_sig_section = signature::construct_signature_section(
            &pubkey,
            &wrapper_indices,
            &wrapper_signature,
            &tx,
        )?;
        tx.add_section(wrapper_sig_section);

        tx.protocol_filter();

        to_js_result(borsh::to_vec(&tx)?)
    }

    pub async fn build_transparent_transfer(
        &self,
        transfer_msg: &[u8],
        wrapper_tx_msg: &[u8],
        _gas_payer: Option<String>,
    ) -> Result<BuiltTx, JsError> {
        let mut args = args::transparent_transfer_tx_args(transfer_msg, wrapper_tx_msg)?;
        let (tx, signing_data) = build_transparent_transfer(&self.namada, &mut args).await?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    pub async fn build_ibc_transfer(
        &self,
        ibc_transfer_msg: &[u8],
        wrapper_tx_msg: &[u8],
        _gas_payer: Option<String>,
    ) -> Result<BuiltTx, JsError> {
        let args = args::ibc_transfer_tx_args(ibc_transfer_msg, wrapper_tx_msg)?;
        let (tx, signing_data, _) = build_ibc_transfer(&self.namada, &args).await?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    pub async fn build_eth_bridge_transfer(
        &self,
        eth_bridge_transfer_msg: &[u8],
        wrapper_tx_msg: &[u8],
        _gas_payer: Option<String>,
    ) -> Result<BuiltTx, JsError> {
        let args = args::eth_bridge_transfer_tx_args(eth_bridge_transfer_msg, wrapper_tx_msg)?;
        let (tx, signing_data) = build_bridge_pool_tx(&self.namada, args.clone()).await?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    pub async fn build_vote_proposal(
        &self,
        vote_proposal_msg: &[u8],
        wrapper_tx_msg: &[u8],
        _gas_payer: Option<String>,
    ) -> Result<BuiltTx, JsError> {
        let args = args::vote_proposal_tx_args(vote_proposal_msg, wrapper_tx_msg)?;
        let epoch = query_epoch(self.namada.client()).await?;
        let (tx, signing_data) = build_vote_proposal(&self.namada, &args, epoch)
            .await
            .map_err(JsError::from)?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    pub async fn build_claim_rewards(
        &self,
        claim_rewards_msg: &[u8],
        wrapper_tx_msg: &[u8],
    ) -> Result<BuiltTx, JsError> {
        let args = args::claim_rewards_tx_args(claim_rewards_msg, wrapper_tx_msg)?;
        let (tx, signing_data) = build_claim_rewards(&self.namada, &args)
            .await
            .map_err(JsError::from)?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    pub async fn build_bond(
        &self,
        bond_msg: &[u8],
        wrapper_tx_msg: &[u8],
        _gas_payer: Option<String>,
    ) -> Result<BuiltTx, JsError> {
        let args = args::bond_tx_args(bond_msg, wrapper_tx_msg)?;
        let (tx, signing_data) = build_bond(&self.namada, &args).await?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    pub async fn build_unbond(
        &self,
        unbond_msg: &[u8],
        wrapper_tx_msg: &[u8],
        _gas_payer: Option<String>,
    ) -> Result<BuiltTx, JsError> {
        let args = args::unbond_tx_args(unbond_msg, wrapper_tx_msg)?;
        let (tx, signing_data, _) = build_unbond(&self.namada, &args).await?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    pub async fn build_withdraw(
        &self,
        withdraw_msg: &[u8],
        wrapper_tx_msg: &[u8],
        _gas_payer: Option<String>,
    ) -> Result<BuiltTx, JsError> {
        let args = args::withdraw_tx_args(withdraw_msg, wrapper_tx_msg)?;
        let (tx, signing_data) = build_withdraw(&self.namada, &args).await?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    pub async fn build_redelegate(
        &self,
        redelegate_msg: &[u8],
        wrapper_tx_msg: &[u8],
        _gas_payer: Option<String>,
    ) -> Result<BuiltTx, JsError> {
        let args = args::redelegate_tx_args(redelegate_msg, wrapper_tx_msg)?;
        let (tx, signing_data) = build_redelegation(&self.namada, &args).await?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    pub async fn build_reveal_pk(&self, wrapper_tx_msg: &[u8]) -> Result<BuiltTx, JsError> {
        let args = args::tx_args_from_slice(wrapper_tx_msg)?;
        let public_key = args.signing_keys[0].clone();

        let (tx, signing_data) = build_reveal_pk(&self.namada, &args.clone(), &public_key).await?;

        Ok(BuiltTx {
            tx: borsh::to_vec(&tx)?,
            signing_data: vec![signing_data],
        })
    }

    // Helper function to reveal public key
    pub async fn reveal_pk(
        &self,
        signing_key: String,
        wrapper_tx_msg: &[u8],
        chain_id: Option<String>,
    ) -> Result<(), JsError> {
        let args = args::tx_args_from_slice(wrapper_tx_msg)?;
        let pk = &args
            .signing_keys
            .clone()
            .into_iter()
            .nth(0)
            .expect("No public key provided");
        let address = Address::from(pk);

        if is_reveal_pk_needed(self.namada.client(), &address).await? {
            let built_tx = self.build_reveal_pk(wrapper_tx_msg).await?;
            // Conversion from JsValue so we can use self.sign_tx
            let tx_bytes =
                Uint8Array::new(&self.sign_tx(built_tx, Some(signing_key), chain_id).await?)
                    .to_vec();
            self.process_tx(&tx_bytes, wrapper_tx_msg).await?;
        }

        Ok(())
    }

    // Sign arbitrary data with the provided signing key
    pub fn sign_arbitrary(&self, signing_key: String, data: String) -> Result<JsValue, JsError> {
        let hash = Hash::sha256(&data);
        let secret = common::SecretKey::Ed25519(ed25519::SecretKey::from_str(&signing_key)?);
        let signature = common::SigScheme::sign(&secret, &hash);
        let sig_bytes = signature.to_bytes();

        to_js_result((hash.to_string().to_lowercase(), hex::encode(sig_bytes)))
    }

    // Verify signed arbitrary data
    pub fn verify_arbitrary(
        &self,
        public_key: String,
        signed_hash: String,
        signature: String,
    ) -> Result<JsValue, JsError> {
        let public_key = common::PublicKey::from_str(&public_key)?;
        let sig = common::Signature::try_from_slice(&hex::decode(&signature)?)?;
        let signed_hash = Hash::from_str(&signed_hash)?;
        let result = common::SigScheme::verify_signature(&public_key, &signed_hash, &sig)?;

        to_js_result(result)
    }
}

#[wasm_bindgen(module = "/src/sdk/mod.js")]
extern "C" {
    #[wasm_bindgen(catch, js_name = "getMaspParams")]
    async fn get_masp_params() -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch, js_name = "hasMaspParams")]
    async fn has_masp_params() -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch, js_name = "fetchAndStoreMaspParams")]
    async fn fetch_and_store_masp_params() -> Result<JsValue, JsValue>;
}
