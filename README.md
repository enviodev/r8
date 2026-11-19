# R8 indexer

A [HyperIndex](https://docs.envio.dev) indexer for [R8](https://r8rate.com) — perpetual
two-sided opinion markets on Solana — streamed from HyperSync.

- **Dashboard:** https://enviodev.github.io/r8/ (source in `docs/`, a single static page)
- **GraphQL:** https://enviodev-d1e1b1f.internal.hyperindex.xyz/v1/graphql (Envio Cloud staging)
- **Program:** [`r8aL8ziDaEq2A9tS89e29cGhDuSN4tNq5o5fbxkQ8r8`](https://solscan.io/account/r8aL8ziDaEq2A9tS89e29cGhDuSN4tNq5o5fbxkQ8r8) (Solana mainnet)
- **Coverage:** the program's full history, from its first transaction
  (slot 452,272,309, 2026-10-01) to the chain head
- **Backfill time:** about 30 seconds on a laptop

## What it indexes

R8 reports everything through Anchor events. This indexer decodes all seven that carry
market activity:

| Event | Becomes |
|---|---|
| `MarketCreated` | `Market` — question, tickers, creator, beneficiary, quote asset, side mints, crown threshold |
| `Trade` (buy / sell / swap) | `Trade`, plus running totals on `Market`, `Position`, `Trader`, `QuoteAsset`, `MarketDailyStat` |
| Creator / beneficiary / protocol fee claim | `FeeClaim`, plus claimed-so-far totals on `Market` |
| Quote listing created / updated | `QuoteAsset` listing terms (quantum, crown threshold) |

Entities, in `schema.graphql`:

- **`Market`** — one per market: static launch data plus live `supply0` / `supply1`,
  `volume`, trade counts, last fill price per side, and the fee split
  (`creatorFees`, `beneficiaryFees`, `protocolFees`, each with a `…Claimed` counterpart, so
  accrued = earned − claimed).
- **`Trade`** — every fill, with tokens, quote charged / paid out, fee split, fill price and
  the supply of both sides after it.
- **`Position`** — a wallet's net side-token balances and quote spent / received per market.
- **`Trader`** — per-wallet activity counts and markets created.
- **`FeeClaim`** — every fee sweep, by seat.
- **`QuoteAsset`** — per quote mint (SOL, USDC, tokenized stocks, memecoins…): listing terms,
  market count, volume, fees.
- **`MarketDailyStat`** — per-market UTC-day buckets for charts.
- **`ProtocolStats`** — one row of protocol-wide counters.

Amounts are raw atoms: quote amounts in the market's `quoteMint` (divide by
`10^quoteDecimals`), side tokens with 6 decimals.

## Accuracy

The R8 program has no published IDL, so the event layouts in `config.yaml` were recovered
from mainnet transactions and then checked against R8's own public API and raw chain data
(2026-11-19):

- Side-token supply matches `GET /api/v1/markets` for **34 of 34** listed markets.
- Creator and beneficiary fee totals and claims match `GET /api/v1/markets/{id}/fees` for
  **34 of 34** markets.
- Trade, market and fee-claim counts match a full RPC scan of the program
  (463 trades, 51 markets, 16 claims).
- Each trade's quote amounts match the market vault's actual balance change in that
  transaction, for all 363 buys and sells.

Two things to know:

- `Market.netQuoteIn` (quote paid in minus quote paid out) equals R8's reported TVL exactly on
  buy-only markets and stays within about 1% on the rest. It is a flow total, not the bonding
  curve's own TVL figure, which needs the curve formula.
- One 32-byte key in `MarketCreated` has a role we couldn't establish; it is decoded as
  `unknown_key` and not stored. Two one-off admin events (protocol config initialisation and
  authority change) are not indexed.

If R8 shares the program's IDL, the hand-written layouts can be replaced with `idl:` in
`config.yaml` and field names aligned with the program's own.

## Run it

Requirements: Node 22.15+, pnpm, Docker, and an Envio API token
(free at https://envio.dev/app/api-tokens).

```bash
cp .env.example .env   # then paste your token into ENVIO_API_TOKEN
pnpm install
pnpm test              # handler tests, no network needed
pnpm dev               # Postgres + Hasura + indexer; GraphQL at http://localhost:8080
```

The GraphQL playground is at http://localhost:8080 (admin secret `testing`).

## Example queries

Most active markets, with both sides' supply and the fee split:

```graphql
{
  Market(order_by: { tradeCount: desc }, limit: 10) {
    question ticker0 ticker1 quoteMint quoteDecimals
    supply0 supply1 volume netQuoteIn tradeCount
    lastPrice0 lastPrice1
    creatorFees creatorFeesClaimed beneficiaryFees beneficiaryFeesClaimed protocolFees
  }
}
```

Live trade feed:

```graphql
{
  Trade(order_by: { slot: desc }, limit: 20) {
    kind side tokens gross fee price time trader txSignature
    market { question ticker0 ticker1 }
  }
}
```

A wallet's positions across markets:

```graphql
query Positions($wallet: String!) {
  Position(where: { trader_id: { _eq: $wallet } }) {
    balance0 balance1 quoteSpent quoteReceived feesPaid tradeCount
    market { question ticker0 ticker1 quoteDecimals lastPrice0 lastPrice1 }
  }
}
```

Markets a creator has launched, and what they have earned and claimed:

```graphql
query Creator($wallet: String!) {
  Market(where: { creator: { _eq: $wallet } }) {
    question volume creatorFees creatorFeesClaimed
  }
}
```

Protocol overview and per-asset rollup:

```graphql
{
  ProtocolStats { marketCount tradeCount buyCount sellCount swapCount traderCount feeClaimCount }
  QuoteAsset(order_by: { tradeCount: desc }) { id decimals marketCount tradeCount volume feesTotal }
}
```

## How it works

Anchor's `emit_cpi!` writes each event as an inner instruction the program sends to itself:
an 8-byte tag (`e445a52e51cb9a1d`), the event's 8-byte discriminator, then its Borsh body.
`config.yaml` declares each event as an instruction keyed on that 16-byte prefix with its
field layout, so HyperIndex decodes it and hands typed `args` to the handlers in
`src/handlers/R8Handlers.ts`. Handlers only accept inner instructions from successful
transactions.

## Layout

- `config.yaml` — program id, start slot, event layouts
- `schema.graphql` — entities
- `src/handlers/R8Handlers.ts` — handlers
- `src/indexer.test.ts` — tests built on real mainnet events
- `docs/index.html` — the dashboard, served by GitHub Pages

## Deployment

Envio Cloud deploys the indexer from the `envio` branch; `main` carries everything else, so
dashboard changes don't trigger a re-index. To ship an indexer change:
`git push origin main:envio`.
