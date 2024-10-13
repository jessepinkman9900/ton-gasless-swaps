import {
  Asset,
  Factory,
  JettonRoot,
  MAINNET_FACTORY_ADDR,
  Pool,
  PoolType,
  VaultNative,
} from "@dedust/sdk";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address, toNano, TonClient4, WalletContractV5R1 } from "@ton/ton";
import pino from "pino";
import dotenv from "dotenv";

dotenv.config();

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty", // optional
    options: {
      colorize: true,
    },
  },
});

async function main() {
  // ------------
  // swap params
  // ------------
  const tokenInAmount = toNano("0.2");
  const tokenOutAddress = Address.parse(
    "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  ); // usdt
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

  const tokenIn = Asset.native();
  const tokenOut = tonClient.open(
    JettonRoot.createFromAddress(tokenOutAddress),
  );

  const pool = tonClient.open(
    Pool.createFromAddress(
      await factory.getPoolAddress({
        poolType: PoolType.VOLATILE,
        assets: [tokenIn, Asset.jetton(tokenOut.address)],
      }),
    ),
  );
  logger.info("pool %s", pool.address.toString());

  const nativeVault = tonClient.open(
    VaultNative.createFromAddress(await factory.getVaultAddress(tokenIn)),
  );
  logger.info("vault %s", nativeVault.address.toString());

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
    nativeVault.address,
  );

  if (vaultState.account.state.type !== "active") {
    throw new Error("native vault does not exist");
  }

  const { amountOut: expectedAmountOut } = await pool.getEstimatedSwapOut({
    assetIn: tokenIn,
    amountIn: tokenInAmount,
  });
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
  const sender = wallet.sender(keys.secretKey);
  let result = await nativeVault.sendSwap(sender, {
    poolAddress: pool.address,
    amount: tokenInAmount,
    limit: minAmountOut,
    gasAmount: toNano("0.1"),
  });
  logger.info(result);
}

main();

/*
successful txn - https://tonscan.org/tx/2711ef4ebe0bf7b80cad2cc231db57b23467db6304f24be6163c63ee950c46b4
*/
