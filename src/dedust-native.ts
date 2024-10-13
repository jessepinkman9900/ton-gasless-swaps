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
  level: "info", // Set the default log level
  transport: {
    target: "pino-pretty", // Optional for pretty logging in development
    options: {
      colorize: true, // Colorize output for better readability
    },
  },
});

async function main() {
  //   const tokenInAddress = Asset.native(); // ton
  const tokenInAmount = toNano("0.1");
  const tokenOutAddress = Address.parse(
    "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  ); // usdt
  //   const poolTypeVolatile = true;

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
