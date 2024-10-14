/*
DOES NOT WORK
DETAILS
- swap 0.05 SCALE TO USDT
- use USDT for gasless txn
- wallet does NOT contain gas in TON. USDT will be used for gas & swap
  - needs ~0.3 TON gas for swap
    - 0.25 is used for forward swap txn
    - 0.05 is used for USDT transfer to vaults USDT wallet
  - needs ~0.1 TON gas for USDT to TON converstion in gasless flow
  - so wallet needs to contain >0.4 (~0.3 + ~0.1) TON worth of USDT in wallet

successful txn - https://tonscan.org/tx/608192262e2ec824144c9a390470335b494c141bc3dba6f1307e8579a246fd21
gas proxy             - EQALyITmdro9yqvnXOpxw41mke0NaonP2V0ncsMve-ASYkcP
user                  - UQAAfErxg2ls6XBF1qRcA004b_wSio_2LysHTncp8COhQE8z
user usdt wallet      - EQBHf1xgMGImruYFwNkUzBqPVLoqGuGdal8dNXHF-W71Dg0w
// gas flow
gas proxy usdt wallet - EQDPKNlPUyVG2bnflQOYf2m38CVE-539STYz6VZXvfk0QjfA
relayer address       - EQDfvVvoSX_cDJ_L38Z2hkhA3fitZCPW1WV9mw6CcNbIrH-Q
// swap flow
vault usdt wallet     - EQCI2sZ8zq25yub6rHEY8FwPqV3zbCqS5oasOdljENCjh0bs
vault usdt            - EQAYqo4u7VF0fa4DPAebk4g9lBytj2VFny7pzXR0trjtXQaO
scale/usdt pool       - EQDyr9Q8SVYiBJnYupTk13ZMYB_iRY3QDFfpfCISCAWxUcWi
vault scale           - EQAf4BMoiqPf0U2ADoNiEatTemiw3UXkt5H90aQpeSKC2l7f
vault scale wallet    - EQC1K9u8EafeJCmMBk2WF-_NoYFTuVUi411XzrebbOLqk88q
user scale wallet     - EQDzsFil69ckC7_IR-yRLqGGTPQR7oV1pHsXWAVq_5o4Yx32
*/

import {
  Asset,
  Factory,
  JettonRoot,
  MAINNET_FACTORY_ADDR,
  Pool,
  PoolType,
  VaultJetton,
} from "@dedust/sdk";
import { mnemonicToPrivateKey } from "@ton/crypto";
import {
  Address,
  beginCell,
  // Cell,
  // external,
  internal,
  // SendMode,
  // storeMessage,
  storeMessageRelaxed,
  toNano,
  TonClient4,
  WalletContractV5R1,
} from "@ton/ton";
import pino from "pino";
import dotenv from "dotenv";
import { Api, TonApiClient } from "@ton-api/client";

dotenv.config();

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty", // optional for pretty logging in development
    options: {
      colorize: true,
    },
  },
});

async function main() {
  // ------------
  // swap params
  // ------------
  const tokenInAddress = Address.parse(
    "EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE",
  ); // scale
  const tokenInAmount = 50_000_000n; // 0.05 scale - decimal 9
  const tokenOutAddress = Address.parse(
    "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  ); // usdt

  // ------------
  // build payload
  // ------------
  const tonClient = new TonClient4({
    endpoint: "https://mainnet-v4.tonhubapi.com",
  });

  const factory = tonClient.open(
    Factory.createFromAddress(MAINNET_FACTORY_ADDR),
  );

  const tokenIn = tonClient.open(JettonRoot.createFromAddress(tokenInAddress));
  const tokenOut = tonClient.open(
    JettonRoot.createFromAddress(tokenOutAddress),
  );

  const pool = tonClient.open(
    Pool.createFromAddress(
      await factory.getPoolAddress({
        poolType: PoolType.VOLATILE,
        assets: [Asset.jetton(tokenIn.address), Asset.jetton(tokenOut.address)],
      }),
    ),
  );
  logger.info("pool %s", pool.address.toString());

  const vault = tonClient.open(
    VaultJetton.createFromAddress(
      await factory.getVaultAddress(Asset.jetton(tokenIn.address)),
    ),
  );
  logger.info("vault %s", vault.address.toString());

  const lastBlock = await tonClient.getLastBlock();
  const poolState = await tonClient.getAccountLite(
    lastBlock.last.seqno,
    pool.address,
  );

  if (poolState.account.state.type !== "active") {
    throw new Error("pool does not exist");
  }

  const vaultState = await tonClient.getAccountLite(
    lastBlock.last.seqno,
    vault.address,
  );

  if (vaultState.account.state.type !== "active") {
    throw new Error("native vault does not exist");
  }

  const { amountOut: expectedAmountOut } = await pool.getEstimatedSwapOut({
    assetIn: Asset.jetton(tokenIn.address),
    amountIn: tokenInAmount,
  });
  logger.info("amountIn %d", tokenInAmount);
  logger.info("expectedAmountOut %d", expectedAmountOut);

  // slippage
  const minAmountOut = (expectedAmountOut * 99n) / 100n; // expectedAmountOut - 1%
  logger.info("minAmountOut %d", minAmountOut);

  if (!process.env.MNEMONIC) {
    throw new Error("mnemonic missing");
  }
  let mnemonic = process.env.MNEMONIC.split(",");
  const keys = await mnemonicToPrivateKey(mnemonic);
  const wallet = tonClient.open(
    WalletContractV5R1.create({
      workchain: 0,
      publicKey: keys.publicKey,
    }),
  );
  logger.info("wallet address %s", wallet.address.toString());

  // gasless
  const http = new TonApiClient({
    baseUrl: "https://tonapi.io",
    // apiKey: 'YOUR API KEY'
  });
  const tonApiClient = new Api(http);
  const cfg = await tonApiClient.gasless.gaslessConfig();
  // console.log('Available jettons for gasless transfer');
  // console.log(cfg?.gasJettons.map(gasJetton => gasJetton.masterId));
  logger.info(`Relay address to send fees to: ${cfg.relayAddress}`);
  const relayerAddress = cfg.relayAddress;

  const OP_CODES = {
    TK_RELAYER_FEE: 0x878da6e3,
    JETTON_TRANSFER: 0xf8a7ea5,
  };
  const tokenInJettonWallet = tonClient.open(await tokenIn.getWallet(wallet.address));
  logger.info("tokenIn JettonWallet %s", tokenInJettonWallet.address);
  const tokenOutJettonWallet = tonClient.open(await tokenOut.getWallet(wallet.address));
  logger.info("tokenOut JettonWallet %s", tokenOutJettonWallet.address);

  const vaultSwapPayload = VaultJetton.createSwapPayload({
    poolAddress: pool.address,
    // swapParams: {
    //   recipientAddress: wallet.address,
    //   limit: minAmountOut,
    // },
  });
  // logger.info("vaultSwapPayload %o", vaultSwapPayload)

  // payload_1 - send tokenIn to tokenInVault - then perform swap on the vault
  const tokenInTransferPayload = beginCell()
    .storeUint(OP_CODES.JETTON_TRANSFER, 32)
    .storeUint(0, 64) // query_id
    .storeCoins(tokenInAmount) // amount
    .storeAddress(vault.address) // destination
    .storeAddress(relayerAddress) // response_destination - return gas to relayer
    .storeBit(false) // null custom_payload
    .storeCoins(toNano(0.25)) // forward_ton_amount
    // .storeBit(true) // forward_payload in this slice
    .storeMaybeRef(vaultSwapPayload) // forward_payload
    .endCell();
  logger.info(
    "tokenInTransferBoc %s",
    tokenInTransferPayload.toBoc().toString("hex"),
  );

  // payload - from gasless contract to tokenInWallet with payload_1
  const messageToEstimate = beginCell()
    .storeWritable(
      storeMessageRelaxed(
        internal({
          to: tokenInJettonWallet.address,
          value: toNano(0.3), // attached_amount
          body: tokenInTransferPayload,
        }),
      ),
    )
    .endCell();
  logger.info("jettonWallet %s", messageToEstimate.toBoc().toString("hex"));

  const gaslessEstimate = await tonApiClient.gasless
    .gaslessEstimate(tokenOut.address, {
      walletAddress: wallet.address,
      walletPublicKey: wallet.publicKey.toString("hex"),
      messages: [
        {
          boc: messageToEstimate,
        },
      ],
    })
    .catch((res) => res.json().then(console.error));
  // logger.info("gassless estimate %j", gaslessEstimate);
  console.log("Estimated transfer:", gaslessEstimate);

  // // sign params
  // const seqno = await wallet.getSeqno();
  // const tokenInTransferForSend = wallet.createTransfer({
  //   seqno: seqno,
  //   authType: "internal",
  //   timeout: Math.ceil(Date.now() / 1000 + 5 * 60),
  //   secretKey: keys.secretKey,
  //   sendMode: SendMode.PAY_GAS_SEPARATELY,
  //   messages: gaslessEstimate?.messages.map(
  //     (msg: { address: Address; amount: bigint; payload: Cell }) =>
  //       internal({
  //         to: msg.address,
  //         value: BigInt(msg.amount),
  //         body: msg.payload,
  //       }),
  //   ),
  // });

  // // payload - sign txn with 2 messages
  // // from gasless contract to user wallet
  // const extMessage = beginCell()
  //   .storeWritable(
  //     storeMessage(
  //       external({
  //         to: wallet.address,
  //         init: seqno === 0 ? wallet.init : undefined,
  //         body: tokenInTransferForSend,
  //       }),
  //     ),
  //   )
  //   .endCell();
  // logger.info("extMessage %s", extMessage.toBoc().toString("hex"));

  // // ------------
  // // send txn
  // // ------------
  // // send gasless transfer
  // tonApiClient.gasless
  //   .gaslessSend({
  //     walletPublicKey: keys.publicKey.toString("hex"),
  //     boc: extMessage,
  //   })
  //   .then(() => console.log("A gasless transfer sent!"))
  //   .catch((res) => res.json().then(console.error));
}

main();
