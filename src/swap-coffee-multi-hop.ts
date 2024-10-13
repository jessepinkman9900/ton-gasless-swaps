import pino from "pino";
import { ApiTokenAddress, RoutingApi } from "@swap-coffee/sdk";
// import TonConnect from "@tonconnect/sdk";

const logger = pino({
  level: "info", // Set the default log level
  transport: {
    target: "pino-pretty", // Optional for pretty logging in development
    options: {
      colorize: true, // Colorize output for better readability
    },
  },
});

// const connector = new TonConnect();

async function main(): Promise<void> {
  logger.info("start");

  const routingApi = new RoutingApi();

  // assets
  const assetIn: ApiTokenAddress = {
    blockchain: "ton",
    address: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs", // usdt
  };
  const amountIn = 0.5; // 0.5 usdt

  const assetOut: ApiTokenAddress = {
    blockchain: "ton",
    address: "EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE", // scale
  };

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
    sender_address: "UQAAfErxg2ls6XBF1qRcA004b_wSio_2LysHTncp8COhQE8z", // todo: get from wallet connector
    slippage: 0.1, // 10% slippage
    paths: route?.data?.paths,
  });
  logger.info("txn payload");
  logger.info(txn.data);

  // // wallet
  // const walletList = await TonConnect.getWallets();
  // logger.info("wallets");
  // logger.info(walletList);
}

main();
