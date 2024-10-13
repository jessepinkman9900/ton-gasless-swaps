# ton-gassless-swaps

## Pre-Req

- only [w5](https://github.com/tonkeeper/w5) wallets support gasless transactions
- gasless txn provider [tonconsole](https://docs.tonconsole.com/tonapi/cookbook)

## Tools

- [mise](https://mise.jdx.dev/getting-started.html)

## Usage

```zsh
mise install
yarn install
```

```zsh
cp .env.example .env
# update mnemonic - comma separated value
```

```sh
# prettier fmt code
yarn fmt
```

```zsh
# dedust - swap 0.2 TON to USDT with gas
yarn run ts-node src/dedust-native.ts

# dedust - swap 0.2 USDT to SCALE with gas
yarn run ts-node src/dedust-jetton-gas.ts

# dedust - swap 0.2 USDT to SCALE + additional USDT for gasless flow
yarn run ts-node src/dedust-jetton-in-gasless.ts
```

## Resources
- https://docs.ton.org/participate/wallets/contracts#wallet-v5
- https://docs.tonconsole.com/tonapi/rest-api/gasless#implementation-examples
- https://docs.tonconsole.com/tonapi/cookbook
- https://tonwhales.com/tools/boc
- https://docs.ton.org/develop/dapps/asset-processing/jettons
- https://github.com/ton-blockchain/token-contract/blob/main/ft/jetton-wallet.fc
- https://github.com/ton-org/ton/blob/master/src/wallets/v5r1/WalletContractV5R1.ts
- emulate txn - https://tonapi.io//api-v2 - /v2/wallet/emulate
- https://medium.com/@buidlingmachine/gasless-transactions-on-ton-75469259eff2
