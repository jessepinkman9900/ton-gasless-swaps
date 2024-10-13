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
import { Address, toNano, TonClient4, WalletContractV5R1 } from "@ton/ton";
import pino from "pino";
import dotenv from "dotenv";

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
  const tokenInAmount = 200_000n; // 0.2 usdt
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

  // ------------
  // send txn
  // ------------
  logger.info("jetton in %s", tokenIn.address);
  const jettonWallet = tonClient.open(await tokenIn.getWallet(wallet.address));
  logger.info("jetton in wallet %s", jettonWallet.address);

  const sender = wallet.sender(keys.secretKey);
  const txn = await jettonWallet.sendTransfer(
    sender,
    toNano("0.3"), // attached_amount
    {
      amount: tokenInAmount,
      destination: vault.address,
      responseAddress: wallet.address, // return gas
      forwardAmount: toNano("0.25"), // forward_amount has to be less than attached_amount
      forwardPayload: VaultJetton.createSwapPayload({
        poolAddress: pool.address,
        limit: minAmountOut,
      }),
    },
  );
  console.log("txn", txn);
}

main();

/*
successful txn - https://tonscan.org/tx/be5a7eb0d70cc715f3a980c42dc68cf3842107176cbc2716c6f447e1eaa59af4
*/
