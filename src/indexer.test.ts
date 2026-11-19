import { describe, it } from "vitest";
import { createTestIndexer } from "envio";

// Envio's chain id for Solana mainnet (`id: solana` in config.yaml).
const SOLANA = 7565164;

// Real mainnet data: the $MERT market (SOL-quoted) and its first two buys.
// Expected values are the ones R8's own API reports for these transactions
// (GET /api/v1/activity?marketId=27cacb77-3251-459d-b416-416b9c120bfa).
const MARKET = "2Etp5Jcwh3XmR6dqXLJA5S1DbdSJAjkUmnFYdMKELrte";
const CREATOR = "EsdmUti6omoN5JCt7EvjC931q7TkKynB6AJoWpqrjBqy";
const BENEFICIARY = "7ouSZkvuZ2zNvDtDMNmy87QjefSPDNw9GCGhWVfoJ912";
const BUYER_2 = "HgayLe1EAmxqdhtma64SmHvSQyowG6tA6WNgTUfAyXr5";
const WSOL = "So11111111111111111111111111111111111111112";
const MINT_0 = "2BBdvsExJGDqJmkzkhjP5RztDfBnPfkxBYpZPu2Kcexr";
const MINT_1 = "Ad38PcSCwuzfs1vvMaT83yDMvDp8HF3R4YAu5A6k2adQ";
const SIG_CREATE =
  "5GTPkHZeYMot7NjDRK61Q2ZQ2s8wtxEPngdrHM8fhzu99eJQrDviRen21LN79uX4pfFBVuXtT4DUNS5GpG1egLfN";
const SIG_BUY_1 =
  "53xGKxfhiS1z3b6uusTrgYz3MJKB5K6pmtizdmfUDf2yVBFgXZqDu9oyUouf9dMEzRFYkASphFyUrWDiy48LVsL8";
const SIG_BUY_2 =
  "rMBkLAw6m1pjxKNH7gy8KZuDwAr5Rrh2YqsX8j3V5XZq6Xm9wTqg2HJPHy3qLUFMAo7a4JxXqs6v5yJQBT5fRAo";

const CAP = 1_000_000_000_000_000n;

const created = {
  program: "R8",
  instruction: "market_created_event",
  slot: 470_478_898,
  path: [6, 5],
  isInner: true,
  args: {
    market: MARKET,
    creator: CREATOR,
    beneficiary: BENEFICIARY,
    quote_mint: WSOL,
    quote_decimals: 9,
    quantum: 47_059n,
    promotion_threshold: 102_000_051_000n,
    quote_vault: "ExVc9p7sNryyWPVzyYqVMuikCLaDoqiAfUoiL96ydTud",
    mint_0: MINT_0,
    mint_1: MINT_1,
    unknown_key: "AQUDA1N1TiywwSFvaycABsLyB2HehmTGr8xQq2PKF36i",
    question: "mert",
    ticker_0: "MERT.COOL",
    ticker_1: "MERT.SUCKS",
    slot: 470_478_898n,
  },
  transaction: { signature: SIG_CREATE, success: true },
  block: { time: 1_794_906_714 },
} as const;

const trade = (over: {
  slot: number;
  time: number;
  signature: string;
  trader: string;
  side: number;
  kind: number;
  tokensBurned?: bigint;
  tokens: bigint;
  charged?: bigint;
  payout?: bigint;
  fee: bigint;
  creatorFee: bigint;
  beneficiaryFee: bigint;
  supply0: bigint;
  supply1: bigint;
}) =>
  ({
    program: "R8",
    instruction: "trade_event",
    slot: over.slot,
    path: [4, 3],
    isInner: true,
    args: {
      market: MARKET,
      trader: over.trader,
      side: over.side,
      kind: over.kind,
      quote_in: over.kind === 0 ? (over.charged ?? 0n) : 0n,
      tokens_burned: over.tokensBurned ?? 0n,
      tokens: over.tokens,
      charged: over.charged ?? 0n,
      payout: over.payout ?? 0n,
      fee: over.fee,
      creator_fee: over.creatorFee,
      beneficiary_fee: over.beneficiaryFee,
      quantum: 47_059n,
      remaining_0: CAP - over.supply0,
      remaining_1: CAP - over.supply1,
      slot: BigInt(over.slot),
    },
    transaction: { signature: over.signature, success: true },
    block: { time: over.time },
  }) as const;

const buy1 = trade({
  slot: 470_479_017,
  time: 1_794_906_739,
  signature: SIG_BUY_1,
  trader: CREATOR,
  side: 0,
  kind: 0,
  tokens: 462_810_543_494n,
  charged: 9_840_000n,
  fee: 160_000n,
  creatorFee: 20_000n,
  beneficiaryFee: 20_000n,
  supply0: 462_810_543_494n,
  supply1: 0n,
});

const buy2 = trade({
  slot: 470_506_205,
  time: 1_794_912_575,
  signature: SIG_BUY_2,
  trader: BUYER_2,
  side: 0,
  kind: 0,
  tokens: 1_154_843_178_800n,
  charged: 24_600_000n,
  fee: 400_000n,
  creatorFee: 50_000n,
  beneficiaryFee: 50_000n,
  supply0: 1_617_653_722_294n,
  supply1: 0n,
});

describe("R8 handlers", () => {
  it("indexes a market launch", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [SOLANA]: { simulate: [created] } } });

    t.expect(await indexer.Market.getOrThrow(MARKET)).toMatchObject({
      question: "mert",
      ticker0: "MERT.COOL",
      ticker1: "MERT.SUCKS",
      creator: CREATOR,
      beneficiary: BENEFICIARY,
      quoteMint: WSOL,
      quoteDecimals: 9,
      quantum: 47_059n,
      promotionThreshold: 102_000_051_000n,
      mint0: MINT_0,
      mint1: MINT_1,
      createdSlot: 470_478_898,
      createdAt: 1_794_906_714,
      createdTx: SIG_CREATE,
      tradeCount: 0,
      supply0: 0n,
    });
    t.expect(await indexer.QuoteAsset.getOrThrow(WSOL)).toMatchObject({ decimals: 9, marketCount: 1 });
    t.expect(await indexer.Trader.getOrThrow(CREATOR)).toMatchObject({ marketsCreated: 1, tradeCount: 0 });
    t.expect(await indexer.ProtocolStats.getOrThrow("r8")).toMatchObject({
      marketCount: 1,
      quoteAssetCount: 1,
      traderCount: 0,
    });
  });

  it("folds buys into the market, matching R8's API for the same transactions", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [SOLANA]: { simulate: [created, buy1, buy2] } } });

    // API: gross 24600000, creatorFee 50000, protocolFee 300000, tokens 1154843178800, side 0.
    t.expect(await indexer.Trade.getOrThrow(`${SIG_BUY_2}-4.3`)).toMatchObject({
      market_id: MARKET,
      trader: BUYER_2,
      kind: "BUY",
      side: 0,
      tokens: 1_154_843_178_800n,
      gross: 24_600_000n,
      fee: 400_000n,
      creatorFee: 50_000n,
      beneficiaryFee: 50_000n,
      protocolFee: 300_000n,
      supply0After: 1_617_653_722_294n,
      time: 1_794_912_575,
    });

    // API market: supply ["1617653722294", "0"], lastSeq 3 (create + 2 trades).
    const market = await indexer.Market.getOrThrow(MARKET);
    t.expect(market).toMatchObject({
      supply0: 1_617_653_722_294n,
      supply1: 0n,
      tradeCount: 2,
      buyCount: 2,
      volume: 34_440_000n,
      netQuoteIn: 34_440_000n,
      feesTotal: 560_000n,
      creatorFees: 70_000n,
      beneficiaryFees: 70_000n,
      protocolFees: 420_000n,
      lastTradeAt: 1_794_912_575,
    });
    t.expect(market.lastPrice0).toBeCloseTo(24_600_000 / 1_154_843_178_800, 12);

    t.expect(await indexer.Position.getOrThrow(`${MARKET}-${BUYER_2}`)).toMatchObject({
      balance0: 1_154_843_178_800n,
      balance1: 0n,
      quoteSpent: 25_000_000n, // the 0.025 SOL the wallet sent
      feesPaid: 400_000n,
      tradeCount: 1,
    });
    t.expect(await indexer.ProtocolStats.getOrThrow("r8")).toMatchObject({
      tradeCount: 2,
      buyCount: 2,
      traderCount: 2,
    });
    t.expect(await indexer.QuoteAsset.getOrThrow(WSOL)).toMatchObject({
      tradeCount: 2,
      volume: 34_440_000n,
    });
    const day = Math.floor(1_794_912_575 / 86_400) * 86_400;
    t.expect(await indexer.MarketDailyStat.getOrThrow(`${MARKET}-${day}`)).toMatchObject({
      tradeCount: 2,
      volume: 34_440_000n,
      closeSupply0: 1_617_653_722_294n,
    });
  });

  it("moves a position across sides on a swap and pays out on a sell", async (t) => {
    const indexer = createTestIndexer();
    // Synthetic follow-ups: swap 400 of side 0 into 390 of side 1, then sell 100 of side 1.
    const swap = trade({
      slot: 470_506_300,
      time: 1_794_912_600,
      signature: SIG_BUY_1,
      trader: BUYER_2,
      side: 0,
      kind: 2,
      tokensBurned: 400_000_000_000n,
      tokens: 390_000_000_000n,
      charged: 8_364_000n,
      payout: 8_500_000n,
      fee: 136_000n,
      creatorFee: 17_000n,
      beneficiaryFee: 17_000n,
      supply0: 1_217_653_722_294n,
      supply1: 390_000_000_000n,
    });
    const sell = trade({
      slot: 470_506_400,
      time: 1_794_912_700,
      signature: SIG_CREATE,
      trader: BUYER_2,
      side: 1,
      kind: 1,
      tokensBurned: 100_000_000_000n,
      tokens: 100_000_000_000n,
      payout: 2_000_000n,
      fee: 32_000n,
      creatorFee: 4_000n,
      beneficiaryFee: 4_000n,
      supply0: 1_217_653_722_294n,
      supply1: 290_000_000_000n,
    });
    await indexer.process({ chains: { [SOLANA]: { simulate: [created, buy1, buy2, swap, sell] } } });

    t.expect(await indexer.Trade.getOrThrow(`${SIG_BUY_1}-4.3`)).toMatchObject({
      kind: "SWAP",
      side: 0,
      gross: 8_500_000n,
      price: undefined,
    });
    t.expect(await indexer.Position.getOrThrow(`${MARKET}-${BUYER_2}`)).toMatchObject({
      balance0: 754_843_178_800n,
      balance1: 290_000_000_000n,
      quoteSpent: 25_000_000n,
      quoteReceived: 1_968_000n,
      tradeCount: 3,
    });
    t.expect(await indexer.Market.getOrThrow(MARKET)).toMatchObject({
      supply0: 1_217_653_722_294n,
      supply1: 290_000_000_000n,
      // 34,440,000 + (8,364,000 - 8,500,000) - 2,000,000
      netQuoteIn: 32_304_000n,
      volume: 44_940_000n,
      tradeCount: 4,
      buyCount: 2,
      sellCount: 1,
      swapCount: 1,
    });
    t.expect(await indexer.Trader.getOrThrow(BUYER_2)).toMatchObject({
      tradeCount: 3,
      buyCount: 1,
      sellCount: 1,
      swapCount: 1,
    });
  });

  it("records fee claims per seat and tracks what each seat has swept", async (t) => {
    const indexer = createTestIndexer();
    const claim = (instruction: "creator_claim_event" | "beneficiary_claim_event", amount: bigint, slot: number) =>
      ({
        program: "R8",
        instruction,
        slot,
        path: [0, 2],
        isInner: true,
        args: { market: MARKET, recipient: CREATOR, amount, slot: BigInt(slot) },
        transaction: { signature: instruction === "creator_claim_event" ? SIG_BUY_1 : SIG_BUY_2, success: true },
        block: { time: 1_794_913_000 },
      }) as const;
    await indexer.process({
      chains: {
        [SOLANA]: {
          simulate: [
            created,
            buy1,
            buy2,
            claim("creator_claim_event", 70_000n, 470_507_000),
            claim("beneficiary_claim_event", 20_000n, 470_507_001),
          ],
        },
      },
    });

    t.expect(await indexer.FeeClaim.getOrThrow(`${SIG_BUY_1}-0.2`)).toMatchObject({
      market_id: MARKET,
      seat: "CREATOR",
      recipient: CREATOR,
      amount: 70_000n,
    });
    t.expect(await indexer.Market.getOrThrow(MARKET)).toMatchObject({
      creatorFees: 70_000n,
      creatorFeesClaimed: 70_000n,
      beneficiaryFees: 70_000n,
      beneficiaryFeesClaimed: 20_000n,
      protocolFeesClaimed: 0n,
    });
    t.expect(await indexer.ProtocolStats.getOrThrow("r8")).toMatchObject({ feeClaimCount: 2 });
  });

  it("tracks quote listings and their updated terms", async (t) => {
    const indexer = createTestIndexer();
    // Real mainnet listing of 9cRCn9…pump, re-priced before the "Best stream" market launched in it.
    const MINT = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";
    const LISTING = "J8rJizW3rgpKM3j27C3s25zwbhpauFoXwkmbKZ4brhSn";
    const AUTHORITY = "J5BuRb3SDnDmY3vz3nNzZr7DRvAY3mqPdXui46W3dQtM";
    await indexer.process({
      chains: {
        [SOLANA]: {
          simulate: [
            {
              program: "R8",
              instruction: "quote_listing_created_event",
              slot: 465_000_000,
              isInner: true,
              args: {
                listing: LISTING,
                quote_mint: MINT,
                authority: AUTHORITY,
                quantum: 56_806n,
                promotion_threshold: 84_497_521_406n,
                slot: 465_000_000n,
              },
              transaction: { signature: SIG_CREATE, success: true },
              block: { time: 1_793_700_000 },
            },
            {
              program: "R8",
              instruction: "quote_listing_updated_event",
              slot: 465_697_134,
              isInner: true,
              args: {
                listing: LISTING,
                quote_mint: MINT,
                authority: AUTHORITY,
                old_quantum: 56_806n,
                new_quantum: 20_108n,
                old_promotion_threshold: 84_497_521_406n,
                new_promotion_threshold: 238_710_960_812n,
                slot: 465_697_134n,
              },
              transaction: { signature: SIG_BUY_1, success: true },
              block: { time: 1_793_879_930 },
            },
          ],
        },
      },
    });

    t.expect(await indexer.QuoteAsset.getOrThrow(MINT)).toMatchObject({
      listing: LISTING,
      listingAuthority: AUTHORITY,
      quantum: 20_108n,
      promotionThreshold: 238_710_960_812n,
      listedAt: 1_793_700_000,
      listingUpdatedAt: 1_793_879_930,
      decimals: undefined,
      marketCount: 0,
    });
  });

  it("ignores events from failed transactions", async (t) => {
    const indexer = createTestIndexer();
    const failed = { ...buy1, transaction: { signature: SIG_BUY_1, success: false } };
    await indexer.process({ chains: { [SOLANA]: { simulate: [created, failed] } } });
    t.expect(await indexer.Market.getOrThrow(MARKET)).toMatchObject({ tradeCount: 0 });
  });
});
