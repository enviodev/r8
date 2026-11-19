/*
 * R8 (r8rate.com) — perpetual two-sided opinion markets on Solana.
 *
 * The program reports through Anchor `emit_cpi!` events, declared in
 * config.yaml as `*_event` instructions: market launches, trades, fee claims
 * and quote listings. Their decoded bodies arrive here as `instruction.args`.
 *
 * Units: quote amounts are raw atoms of the market's quote mint; side-token
 * amounts are raw atoms of the side mints.
 */
import {
  indexer,
  type Market,
  type Position,
  type ProtocolStats,
  type QuoteAsset,
  type Trader,
} from "envio";

const STATS_ID = "r8";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/** Each side's mint is capped at 1e15 atoms; a trade event reports what is still unminted. */
export const SIDE_SUPPLY_CAP = 1_000_000_000_000_000n;
const DAY = 86_400;

const KINDS = ["BUY", "SELL", "SWAP"] as const;

const fields = {
  instruction: ["args", "path"],
  transaction: ["signature", "success"],
  block: ["time"],
} as const;

/** Anchor events are only genuine as a CPI the program makes to itself. */
const where = { isInner: true } as const;

const emptyStats: ProtocolStats = {
  id: STATS_ID,
  marketCount: 0,
  tradeCount: 0,
  buyCount: 0,
  sellCount: 0,
  swapCount: 0,
  traderCount: 0,
  quoteAssetCount: 0,
  feeClaimCount: 0,
  lastSlot: 0,
  lastTradeAt: undefined,
};

const newTrader = (id: string, time: number): Trader => ({
  id,
  tradeCount: 0,
  buyCount: 0,
  sellCount: 0,
  swapCount: 0,
  marketsCreated: 0,
  firstSeenAt: time,
  lastSeenAt: time,
});

const newQuoteAsset = (id: string): QuoteAsset => ({
  id,
  decimals: undefined,
  listing: undefined,
  listingAuthority: undefined,
  quantum: undefined,
  promotionThreshold: undefined,
  listedAt: undefined,
  listingUpdatedAt: undefined,
  marketCount: 0,
  tradeCount: 0,
  volume: 0n,
  feesTotal: 0n,
  netQuoteIn: 0n,
});

// ---- Market launch ----

indexer.onInstruction(
  { program: "R8", instruction: "market_created_event", fields, where },
  async ({ instruction, context }) => {
    if (instruction.transaction.success === false) return;
    const a = instruction.args;
    const slot = instruction.block.slot;
    const time = instruction.block.time;

    const [stats, asset, creator] = await Promise.all([
      context.ProtocolStats.get(STATS_ID),
      context.QuoteAsset.get(a.quote_mint),
      context.Trader.get(a.creator),
    ]);

    context.Market.set({
      id: a.market,
      question: a.question,
      ticker0: a.ticker_0,
      ticker1: a.ticker_1,
      creator: a.creator,
      beneficiary: a.beneficiary === SYSTEM_PROGRAM ? undefined : a.beneficiary,
      quoteMint: a.quote_mint,
      quoteAsset_id: a.quote_mint,
      quoteDecimals: a.quote_decimals,
      quantum: a.quantum,
      promotionThreshold: a.promotion_threshold,
      quoteVault: a.quote_vault,
      mint0: a.mint_0,
      mint1: a.mint_1,
      createdSlot: slot,
      createdAt: time,
      createdTx: instruction.transaction.signature,
      supply0: 0n,
      supply1: 0n,
      netQuoteIn: 0n,
      volume: 0n,
      feesTotal: 0n,
      creatorFees: 0n,
      beneficiaryFees: 0n,
      protocolFees: 0n,
      creatorFeesClaimed: 0n,
      beneficiaryFeesClaimed: 0n,
      protocolFeesClaimed: 0n,
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      swapCount: 0,
      lastPrice0: undefined,
      lastPrice1: undefined,
      lastTradeAt: undefined,
      lastTradeSlot: undefined,
    });

    const prevAsset = asset ?? newQuoteAsset(a.quote_mint);
    context.QuoteAsset.set({
      ...prevAsset,
      decimals: a.quote_decimals,
      marketCount: prevAsset.marketCount + 1,
    });

    const prevCreator = creator ?? newTrader(a.creator, time);
    context.Trader.set({
      ...prevCreator,
      marketsCreated: prevCreator.marketsCreated + 1,
      lastSeenAt: Math.max(prevCreator.lastSeenAt, time),
    });

    const prevStats = stats ?? emptyStats;
    context.ProtocolStats.set({
      ...prevStats,
      marketCount: prevStats.marketCount + 1,
      quoteAssetCount: prevStats.quoteAssetCount + (prevAsset.marketCount === 0 ? 1 : 0),
      lastSlot: Math.max(prevStats.lastSlot, slot),
    });
  },
);

// ---- Buy / sell / swap ----

indexer.onInstruction(
  { program: "R8", instruction: "trade_event", fields, where },
  async ({ instruction, context }) => {
    if (instruction.transaction.success === false) return;
    const a = instruction.args;
    const kind = KINDS[a.kind];
    if (kind === undefined || (a.side !== 0 && a.side !== 1)) {
      context.log.warn(`R8 trade with unknown kind ${a.kind} / side ${a.side}; skipped`);
      return;
    }
    const slot = instruction.block.slot;
    const time = instruction.block.time;
    const txSignature = instruction.transaction.signature;
    const positionId = `${a.market}-${a.trader}`;
    const dayStart = Math.floor(time / DAY) * DAY;
    const dailyId = `${a.market}-${dayStart}`;

    const [market, stats, trader, position, daily] = await Promise.all([
      context.Market.get(a.market),
      context.ProtocolStats.get(STATS_ID),
      context.Trader.get(a.trader),
      context.Position.get(positionId),
      context.MarketDailyStat.get(dailyId),
    ]);
    if (!market) {
      // Every market's creation is inside the indexed range, so this only fires
      // if start_slot is raised past a market's launch.
      context.log.warn(`R8 trade on unindexed market ${a.market}; skipped`);
      return;
    }
    const asset = await context.QuoteAsset.get(market.quoteMint);

    const gross = kind === "BUY" ? a.charged : a.payout;
    const protocolFee = a.fee - a.creator_fee - a.beneficiary_fee;
    const supply0 = SIDE_SUPPLY_CAP - a.remaining_0;
    const supply1 = SIDE_SUPPLY_CAP - a.remaining_1;
    const poolDelta = a.charged - a.payout;
    const price = kind !== "SWAP" && a.tokens > 0n ? Number(gross) / Number(a.tokens) : undefined;

    context.Trade.set({
      id: `${txSignature}-${instruction.path.join(".")}`,
      market_id: a.market,
      trader: a.trader,
      kind,
      side: a.side,
      tokens: a.tokens,
      tokensBurned: a.tokens_burned,
      charged: a.charged,
      payout: a.payout,
      gross,
      fee: a.fee,
      creatorFee: a.creator_fee,
      beneficiaryFee: a.beneficiary_fee,
      protocolFee,
      price,
      supply0After: supply0,
      supply1After: supply1,
      slot,
      time,
      txSignature,
    });

    const netQuoteIn = market.netQuoteIn + poolDelta;
    const nextMarket: Market = {
      ...market,
      supply0,
      supply1,
      netQuoteIn,
      volume: market.volume + gross,
      feesTotal: market.feesTotal + a.fee,
      creatorFees: market.creatorFees + a.creator_fee,
      beneficiaryFees: market.beneficiaryFees + a.beneficiary_fee,
      protocolFees: market.protocolFees + protocolFee,
      tradeCount: market.tradeCount + 1,
      buyCount: market.buyCount + (kind === "BUY" ? 1 : 0),
      sellCount: market.sellCount + (kind === "SELL" ? 1 : 0),
      swapCount: market.swapCount + (kind === "SWAP" ? 1 : 0),
      lastPrice0: price !== undefined && a.side === 0 ? price : market.lastPrice0,
      lastPrice1: price !== undefined && a.side === 1 ? price : market.lastPrice1,
      lastTradeAt: time,
      lastTradeSlot: slot,
    };
    context.Market.set(nextMarket);

    // Position: buys mint to `side`; sells burn from `side`; a swap burns from
    // `side` and mints on the other one.
    const prevPosition: Position = position ?? {
      id: positionId,
      market_id: a.market,
      trader_id: a.trader,
      balance0: 0n,
      balance1: 0n,
      quoteSpent: 0n,
      quoteReceived: 0n,
      feesPaid: 0n,
      tradeCount: 0,
      firstTradeAt: time,
      lastTradeAt: time,
    };
    const delta = [0n, 0n];
    if (kind === "BUY") {
      delta[a.side] = a.tokens;
    } else {
      delta[a.side] = -a.tokens_burned;
      if (kind === "SWAP") delta[1 - a.side] = a.tokens;
    }
    context.Position.set({
      ...prevPosition,
      balance0: prevPosition.balance0 + delta[0]!,
      balance1: prevPosition.balance1 + delta[1]!,
      quoteSpent: prevPosition.quoteSpent + (kind === "BUY" ? a.charged + a.fee : 0n),
      quoteReceived: prevPosition.quoteReceived + (kind === "SELL" ? a.payout - a.fee : 0n),
      feesPaid: prevPosition.feesPaid + a.fee,
      tradeCount: prevPosition.tradeCount + 1,
      lastTradeAt: time,
    });

    const prevTrader = trader ?? newTrader(a.trader, time);
    context.Trader.set({
      ...prevTrader,
      tradeCount: prevTrader.tradeCount + 1,
      buyCount: prevTrader.buyCount + (kind === "BUY" ? 1 : 0),
      sellCount: prevTrader.sellCount + (kind === "SELL" ? 1 : 0),
      swapCount: prevTrader.swapCount + (kind === "SWAP" ? 1 : 0),
      lastSeenAt: time,
    });

    if (asset) {
      context.QuoteAsset.set({
        ...asset,
        tradeCount: asset.tradeCount + 1,
        volume: asset.volume + gross,
        feesTotal: asset.feesTotal + a.fee,
        netQuoteIn: asset.netQuoteIn + poolDelta,
      });
    }

    context.MarketDailyStat.set({
      id: dailyId,
      market_id: a.market,
      dayStart,
      tradeCount: (daily?.tradeCount ?? 0) + 1,
      volume: (daily?.volume ?? 0n) + gross,
      feesTotal: (daily?.feesTotal ?? 0n) + a.fee,
      closeSupply0: supply0,
      closeSupply1: supply1,
      closeNetQuoteIn: netQuoteIn,
    });

    const prevStats = stats ?? emptyStats;
    context.ProtocolStats.set({
      ...prevStats,
      tradeCount: prevStats.tradeCount + 1,
      buyCount: prevStats.buyCount + (kind === "BUY" ? 1 : 0),
      sellCount: prevStats.sellCount + (kind === "SELL" ? 1 : 0),
      swapCount: prevStats.swapCount + (kind === "SWAP" ? 1 : 0),
      traderCount: prevStats.traderCount + (prevTrader.tradeCount === 0 ? 1 : 0),
      lastSlot: Math.max(prevStats.lastSlot, slot),
      lastTradeAt: time,
    });
  },
);

// ---- Fee claims: each seat sweeps its accrued share of a market's fees ----

const CLAIMS = [
  ["creator_claim_event", "CREATOR", "creatorFeesClaimed"],
  ["beneficiary_claim_event", "BENEFICIARY", "beneficiaryFeesClaimed"],
  ["protocol_claim_event", "PROTOCOL", "protocolFeesClaimed"],
] as const;

for (const [event, seat, claimedField] of CLAIMS) {
  indexer.onInstruction(
    { program: "R8", instruction: event, fields, where },
    async ({ instruction, context }) => {
      if (instruction.transaction.success === false) return;
      const a = instruction.args;
      const slot = instruction.block.slot;
      const txSignature = instruction.transaction.signature;

      const [market, stats] = await Promise.all([
        context.Market.get(a.market),
        context.ProtocolStats.get(STATS_ID),
      ]);
      if (!market) {
        context.log.warn(`R8 fee claim on unindexed market ${a.market}; skipped`);
        return;
      }

      context.FeeClaim.set({
        id: `${txSignature}-${instruction.path.join(".")}`,
        market_id: a.market,
        seat,
        recipient: a.recipient,
        amount: a.amount,
        slot,
        time: instruction.block.time,
        txSignature,
      });
      context.Market.set({ ...market, [claimedField]: market[claimedField] + a.amount });

      const prevStats = stats ?? emptyStats;
      context.ProtocolStats.set({
        ...prevStats,
        feeClaimCount: prevStats.feeClaimCount + 1,
        lastSlot: Math.max(prevStats.lastSlot, slot),
      });
    },
  );
}

// ---- Quote listings: which mints may quote a market, and on what terms ----

indexer.onInstruction(
  { program: "R8", instruction: "quote_listing_created_event", fields, where },
  async ({ instruction, context }) => {
    if (instruction.transaction.success === false) return;
    const a = instruction.args;
    const time = instruction.block.time;
    const asset = (await context.QuoteAsset.get(a.quote_mint)) ?? newQuoteAsset(a.quote_mint);
    context.QuoteAsset.set({
      ...asset,
      listing: a.listing,
      listingAuthority: a.authority,
      quantum: a.quantum,
      promotionThreshold: a.promotion_threshold,
      listedAt: time,
      listingUpdatedAt: time,
    });
  },
);

indexer.onInstruction(
  { program: "R8", instruction: "quote_listing_updated_event", fields, where },
  async ({ instruction, context }) => {
    if (instruction.transaction.success === false) return;
    const a = instruction.args;
    const asset = (await context.QuoteAsset.get(a.quote_mint)) ?? newQuoteAsset(a.quote_mint);
    context.QuoteAsset.set({
      ...asset,
      listing: a.listing,
      listingAuthority: a.authority,
      quantum: a.new_quantum,
      promotionThreshold: a.new_promotion_threshold,
      listingUpdatedAt: instruction.block.time,
    });
  },
);
