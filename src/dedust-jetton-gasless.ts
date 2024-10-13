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
  Cell,
  external,
  internal,
  SendMode,
  storeMessage,
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
    "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  ); // usdt
  const tokenInAmount = 200_000n; // 0.2 usdt - decimal 6
  const tokenOutAddress = Address.parse(
    "EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE",
  ); // scale
  //   const poolTypeVolatile = true;

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
  const jettonWallet = tonClient.open(await tokenIn.getWallet(wallet.address));
  logger.info("jetton wallet %s", jettonWallet.address);

  const vaultSwapPayload = VaultJetton.createSwapPayload({
    poolAddress: pool.address,
    // swapParams: {
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
          to: jettonWallet.address,
          value: toNano(0.3), // attached_amount
          body: tokenInTransferPayload,
        }),
      ),
    )
    .endCell();
  logger.info("jettonWallet %s", messageToEstimate.toBoc().toString("hex"));

  const gaslessEstimate = await tonApiClient.gasless
    .gaslessEstimate(tokenIn.address, {
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

  // sign params
  const seqno = await wallet.getSeqno();
  const tokenInTransferForSend = wallet.createTransfer({
    seqno: seqno,
    authType: "internal",
    timeout: Math.ceil(Date.now() / 1000 + 5 * 60),
    secretKey: keys.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: gaslessEstimate?.messages.map(
      (msg: { address: Address; amount: bigint; payload: Cell }) =>
        internal({
          to: msg.address,
          value: BigInt(msg.amount),
          body: msg.payload,
        }),
    ),
  });

  // payload - sign txn with 2 messages
  // from gasless contract to user wallet
  const extMessage = beginCell()
    .storeWritable(
      storeMessage(
        external({
          to: wallet.address,
          init: seqno === 0 ? wallet.init : undefined,
          body: tokenInTransferForSend,
        }),
      ),
    )
    .endCell();
  logger.info("extMessage %s", extMessage.toBoc().toString("hex"));

  // ------------
  // send txn
  // ------------
  // send gasless transfer
  tonApiClient.gasless
    .gaslessSend({
      walletPublicKey: keys.publicKey.toString("hex"),
      boc: extMessage,
    })
    .then(() => console.log("A gasless transfer sent!"))
    .catch((res) => res.json().then(console.error));
}

main();

/*
NOTE
wallet needs to have ~0.5 TON worth in USDT + the amount being swapped
attached_amount = 0.3
gas_needed_for_gasless swap = ~0.2

successful txn - https://tonscan.org/tx/608192262e2ec824144c9a390470335b494c141bc3dba6f1307e8579a246fd21
*/
