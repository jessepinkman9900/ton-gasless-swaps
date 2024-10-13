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

```zsh
# dedust - swap 0.2 TON to USDT with gas
yarn run ts-node src/dedust-native.ts

# dedust - swap 0.2 USDT to SCALE with gas
yarn run ts-node src/dedust-jetton-gas.ts

# dedust - swap 0.2 USDT to SCALE + additional USDT for gasless flow
yarn run ts-node src/dedust-jetton-in-gasless.ts
```
