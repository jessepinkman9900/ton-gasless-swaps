import pino from "pino";
import { ApiTokenAddress, RoutingApi } from "@swap-coffee/sdk";

const logger = pino({
  level: "info", // Set the default log level
  transport: {
    target: "pino-pretty", // Optional for pretty logging in development
    options: {
      colorize: true, // Colorize output for better readability
    },
  },
});

async function main(): Promise<void> {
  logger.info("start");

  const routingApi = new RoutingApi();

  // assets
  const assetIn: ApiTokenAddress = {
    blockchain: "ton",
    address: "native", // stands for ton
  };
  const amountIn = 0.5; // 0.5 TON

  const assetOut: ApiTokenAddress = {
    blockchain: "ton",
    address: "EQCl0S4xvoeGeFGijTzicSA8j6GiiugmJW5zxQbZTUntre-1", // CES
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
    sender_address: "", // todo: get from wallet connector
    slippage: 0.1, // 10% slippage
    paths: route?.data?.paths,
  });
  logger.info("txn payload");
  logger.info(txn.data);
}

main();
