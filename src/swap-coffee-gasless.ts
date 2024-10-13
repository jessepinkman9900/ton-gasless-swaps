import pino from "pino";
import { ApiTokenAddress, RoutingApi } from "@swap-coffee/sdk";
// import TonConnect from "@tonconnect/sdk";
import { Api, TonApiClient } from "@ton-api/client";
import { ContractAdapter } from "@ton-api/ton-adapter";
import {
  Address,
  beginCell,
  Cell,
  toNano,
  internal,
  storeMessageRelaxed,
} from "@ton/core";
import { WalletContractV5R1 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty", // optional
    options: {
      colorize: true,
    },
  },
});

// NOT Working

// const connector = new TonConnect();

async function main(): Promise<void> {
  logger.info("start");

  // init ton api client
  const tonApiHttp = new TonApiClient({ baseUrl: "https://tonapi.io" });
  const tonApiClient = new Api(tonApiHttp);
  const tonApiProvider = new ContractAdapter(tonApiClient);

  // wallet
  if (!process.env.MNEMONIC) {
    throw new Error("mnemonic missing");
  }
  let mnemonic = process.env.MNEMONIC.split(",");
  const keys = await mnemonicToPrivateKey(mnemonic);
  const wallet = tonApiProvider.open(
    WalletContractV5R1.create({
      workchain: 0,
      publicKey: keys.publicKey,
    }),
  );
  logger.info("wallet address %s", wallet.address.toString());

  // swap cofee
  const routingApi = new RoutingApi();

  // assets
  const tokenIn = Address.parse(
    "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  ); // usdt
  const assetIn: ApiTokenAddress = {
    blockchain: "ton",
    address: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs", // usdt
  };
  const amountIn = 0.2; // 0.2 usdt

  const assetOut: ApiTokenAddress = {
    blockchain: "ton",
    address: "EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE", // scale
  };

  // jetton wallet
  const jettonWalletAddressResult =
    await tonApiClient.blockchain.execGetMethodForBlockchainAccount(
      tokenIn,
      "get_wallet_address",
      {
        args: [wallet.address.toRawString()],
      },
    );
  const jettonWallet = Address.parse(
    jettonWalletAddressResult.decoded.jettonWalletAddress,
  );
  logger.info("jetton wallet %s", jettonWallet.toString());

  // route quote
  logger.info("fetching route");
  const route = await routingApi.buildRoute({
    input_token: assetIn,
    input_amount: amountIn,
    output_token: assetOut,
    max_length: 2, // direct swap
  });
  logger.info("route");
  logger.info(route?.data);

  // build txn payload
  logger.info("building txn payload");
  const txn = await routingApi.buildTransactionsV2({
    sender_address: wallet.address.toString(), // todo: get from wallet connector
    slippage: 0.1, // 10% slippage
    paths: route?.data?.paths,
  });
  logger.info("txn payload %o", txn.data);

  //  ----------
  // gasless flow

  // message to estimate

  // logger.info("txn data base64 to boc %o", Cell.fromBase64(txn.data.transactions[0].cell))
  logger.info("txn value %o", BigInt(txn.data.transactions[0].value));
  const BASE_JETTON_SEND_AMOUNT = toNano(0.05);
  const messageToEstimate = beginCell()
    .storeWritable(
      storeMessageRelaxed(
        internal({
          to: Address.parseRaw(txn.data.transactions[0].address),
          value: BASE_JETTON_SEND_AMOUNT,
          body: Cell.fromBase64(txn.data.transactions[0].cell),
        }),
      ),
    )
    .endCell();
  // logger.info("messageToEstimtae %o", messageToEstimate)

  // gasless estimate - get payloads to sign
  // 2 messages
  //   1. fee transfer to relay address
  //   2. original transfer msg
  const params = await tonApiClient.gasless
    .gaslessEstimate(tokenIn, {
      walletAddress: wallet.address,
      walletPublicKey: wallet.publicKey.toString("hex"),
      messages: [
        {
          boc: messageToEstimate,
        },
      ],
    })
    .catch((res) => res.json().then(console.error));
  logger.info("estimated transfer %o", params);
}

main();
