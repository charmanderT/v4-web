import { BonsaiCore } from '@/abacus-ts/ontology';
import { OrderSide } from '@dydxprotocol/v4-client-js';
import BigNumber from 'bignumber.js';
import { groupBy, sum } from 'lodash';

import {
  AbacusMarginMode,
  AbacusOrderSide,
  AbacusOrderStatus,
  AbacusPositionSide,
  HistoricalTradingRewardsPeriod,
  ORDER_SIDES,
  type AbacusOrderStatuses,
  type SubaccountFill,
  type SubaccountFundingPayment,
  type SubaccountOrder,
} from '@/constants/abacus';
import { NUM_PARENT_SUBACCOUNTS, OnboardingState } from '@/constants/account';
import { LEVERAGE_DECIMALS } from '@/constants/numbers';
import { EMPTY_ARR } from '@/constants/objects';

import { mapIfPresent } from '@/lib/do';
import { MustBigNumber } from '@/lib/numbers';
import {
  getAverageFillPrice,
  getHydratedTradingData,
  isOrderStatusClearable,
  isOrderStatusOpen,
  isStopLossOrder,
  isTakeProfitOrder,
} from '@/lib/orders';
import { getHydratedPositionData } from '@/lib/positions';

import { type RootState } from './_store';
import { ALL_MARKETS_STRING } from './accountUiMemory';
import { getSelectedNetwork } from './appSelectors';
import { createAppSelector } from './appTypes';
import { getAssets } from './assetsSelectors';
import {
  getCurrentMarketId,
  getCurrentMarketOrderbook,
  getPerpetualMarkets,
} from './perpetualsSelectors';

/**
 * @param state
 * @returns Abacus' subaccount object
 */
export const getSubaccount = (state: RootState) => state.account.subaccount;

/**
 * @param state
 * @returns Whether or not Abacus' subaccount object exists
 */
export const getHasSubaccount = (state: RootState) => Boolean(state.account.subaccount);

/**
 * @param state
 * @returns identifier of the current subaccount
 */
export const getSubaccountId = (state: RootState) => state.account.subaccount?.subaccountNumber;

/**
 * @param state
 * @returns buyingPower object of current subaccount
 */
export const getSubaccountBuyingPower = (state: RootState) => state.account.subaccount?.buyingPower;

/**
 * @param state
 * @returns equity object of current subaccount
 */
export const getSubaccountEquity = (state: RootState) => state.account.subaccount?.equity;

export const getSubaccountHistoricalPnl = (state: RootState) => state.account.historicalPnl;
/**
 * @param state
 * @returns list of a subaccount's open positions. Each item in the list is an open position in a different market.
 */
export const getOpenPositions = createAppSelector(
  [(state: RootState) => state.account.subaccount?.openPositions],
  (t) => t?.toArray()
);

/**
 * @param state
 * @returns list of a subaccount's open positions, excluding the ones in draft, i.e. with NONE position side.
 */
export const getExistingOpenPositions = createAppSelector([getOpenPositions], (allOpenPositions) =>
  allOpenPositions?.filter((position) => position.side.current !== AbacusPositionSide.NONE)
);

/**
 *
 * @returns All SubaccountOrders that have a margin mode of Isolated and no existing position for the market.
 */
export const getNonZeroPendingPositions = createAppSelector(
  [(state: RootState) => state.account.subaccount?.pendingPositions],
  (pending) => pending?.toArray().filter((p) => (p.equity?.current ?? 0) > 0)
);

/**
 * @param marketId
 * @returns user's position details with the given marketId
 */

export const getPositionDetails = () =>
  createAppSelector(
    [getExistingOpenPositions, getAssets, getPerpetualMarkets, (s, marketId: string) => marketId],
    (positions, assets, perpetualMarkets, marketId) => {
      const matchingPosition = positions?.find((position) => position.id === marketId);
      return matchingPosition
        ? getHydratedPositionData({ data: matchingPosition, assets, perpetualMarkets })
        : undefined;
    }
  );

export const getOpenPositionFromId = (marketId: string) =>
  createAppSelector([getOpenPositions], (allOpenPositions) =>
    allOpenPositions?.find(({ id }) => id === marketId)
  );

/**
 * @param state
 * @returns AccountPositions of the current market
 */
export const getCurrentMarketPositionData = (state: RootState) => {
  const currentMarketId = getCurrentMarketId(state);

  return Object.fromEntries(
    (getOpenPositions(state) ?? []).map((positionData) => [positionData.id, positionData])
  )[currentMarketId!];
};

/**
 * @returns the current leverage of the isolated position. Selector will return null if position is not isolated or does not exist.
 */
export const getCurrentMarketIsolatedPositionLeverage = createAppSelector(
  [getCurrentMarketPositionData],
  (position) => {
    if (
      position?.childSubaccountNumber &&
      position.childSubaccountNumber >= NUM_PARENT_SUBACCOUNTS &&
      position.leverage.current
    ) {
      return Math.abs(Number(position.leverage.current.toFixed(LEVERAGE_DECIMALS)));
    }

    return 0;
  }
);

/**
 * @param state
 * @returns list of orders for the currently connected subaccount
 */
export const getSubaccountOrders = createAppSelector(
  [(state: RootState) => state.account.subaccount?.orders],
  (t) => t?.toArray()
);

/**
 * @param state
 * @returns list of order ids that user has cleared and should be hidden
 */
export const getSubaccountClearedOrderIds = (state: RootState) => state.account.clearedOrderIds;

/**
 * @param state
 * @returns list of orders that user has not cleared and should be displayed
 */
export const getSubaccountUnclearedOrders = createAppSelector(
  [getSubaccountOrders, getSubaccountClearedOrderIds],
  (orders, clearedOrderIds) => orders?.filter((order) => !clearedOrderIds?.includes(order.id))
);

/**
 * @param state
 * @returns Record of SubaccountOrders indexed by marketId
 */
export const getMarketOrders = createAppSelector(
  [getSubaccountUnclearedOrders],
  (orders): { [marketId: string]: SubaccountOrder[] } => {
    return (orders ?? []).reduce(
      (marketOrders, order) => {
        marketOrders[order.marketId] ??= [];
        marketOrders[order.marketId]!.push(order);
        return marketOrders;
      },
      {} as { [marketId: string]: SubaccountOrder[] }
    );
  }
);

/**
 * @param state
 * @returns SubaccountOrders of the current market
 */
export const getCurrentMarketOrders = createAppSelector(
  [getCurrentMarketId, getMarketOrders],
  (currentMarketId, marketOrders): SubaccountOrder[] =>
    !currentMarketId ? EMPTY_ARR : marketOrders[currentMarketId] ?? EMPTY_ARR
);

/**
 * @param state
 * @returns list of orders that have not been filled or cancelled
 */
export const getSubaccountOpenOrders = createAppSelector([getSubaccountOrders], (orders) =>
  orders?.filter((order) => isOpenOrderStatus(order.status))
);

export const getOpenIsolatedOrders = createAppSelector(
  [getSubaccountOrders, getPerpetualMarkets],
  (allOrders, allMarkets) =>
    (allOrders ?? [])
      .filter((o) => isOrderStatusOpen(o.status) && o.marginMode === AbacusMarginMode.Isolated)
      // eslint-disable-next-line prefer-object-spread
      .map((o) => Object.assign({}, o, { assetId: allMarkets?.[o.marketId]?.assetId }))
);

export const getPendingIsolatedOrders = createAppSelector(
  [getOpenIsolatedOrders, getExistingOpenPositions],
  (isolatedOrders, allOpenPositions) => {
    const allOpenPositionAssetIds = new Set(allOpenPositions?.map((p) => p.assetId) ?? []);
    return groupBy(
      isolatedOrders.filter((o) => !allOpenPositionAssetIds.has(o.assetId ?? '')),
      (o) => o.marketId
    );
  }
);

export const getCurrentMarketHasOpenIsolatedOrders = createAppSelector(
  [getOpenIsolatedOrders, getCurrentMarketId],
  (openOrders, marketId) => openOrders.some((o) => o.marketId === marketId)
);

/**
 * @param state
 * @returns order with the specified id
 */
export const getOrderById = () =>
  createAppSelector([getSubaccountOrders, (s, orderId: string) => orderId], (orders, orderId) =>
    orders?.find((order) => order.id === orderId)
  );

/**
 * @param state
 * @returns order with the specified client id
 */
export const getOrderByClientId = () =>
  createAppSelector(
    [getSubaccountOrders, (s, orderClientId: string) => orderClientId],
    (orders, orderClientId) => orders?.find((order) => order.clientId === orderClientId)
  );

/**
 * @param state
 * @returns first matching fill with the specified order client id
 */
export const getFillByClientId = () =>
  createAppSelector([getSubaccountFills, getOrderByClientId()], (fills, order) =>
    fills?.find((fill) => fill.orderId === order?.id)
  );

/**
 * @param state
 * @returns Record of SubaccountOrders that have not been filled or cancelled, indexed by marketId
 */
export const getMarketSubaccountOpenOrders = createAppSelector(
  [getSubaccountOpenOrders],
  (
    orders
  ): {
    [marketId: string]: SubaccountOrder[];
  } => {
    return (orders ?? []).reduce(
      (marketOrders, order) => {
        marketOrders[order.marketId] ??= [];
        marketOrders[order.marketId]!.push(order);
        return marketOrders;
      },
      {} as { [marketId: string]: SubaccountOrder[] }
    );
  }
);

/**
 * @param state
 * @returns list of conditional orders that have not been filled or cancelled for all subaccount positions
 */
export const getSubaccountConditionalOrders = () =>
  createAppSelector(
    [
      getMarketSubaccountOpenOrders,
      getOpenPositions,
      (s, isSlTpLimitOrdersEnabled: boolean) => isSlTpLimitOrdersEnabled,
    ],
    (openOrdersByMarketId, positions, isSlTpLimitOrdersEnabled) => {
      const stopLossOrders: SubaccountOrder[] = [];
      const takeProfitOrders: SubaccountOrder[] = [];

      positions?.forEach((position) => {
        const orderSideForConditionalOrder =
          position.side.current === AbacusPositionSide.LONG
            ? AbacusOrderSide.Sell
            : AbacusOrderSide.Buy;

        const conditionalOrders = openOrdersByMarketId[position.id];

        conditionalOrders?.forEach((order: SubaccountOrder) => {
          if (
            order.side === orderSideForConditionalOrder &&
            isStopLossOrder(order, isSlTpLimitOrdersEnabled)
          ) {
            stopLossOrders.push(order);
          } else if (
            order.side === orderSideForConditionalOrder &&
            isTakeProfitOrder(order, isSlTpLimitOrdersEnabled)
          ) {
            takeProfitOrders.push(order);
          }
        });
      });

      return { stopLossOrders, takeProfitOrders };
    }
  );

/**
 * @param state
 * @returns list of orders that are in the open status
 */
export const getSubaccountOpenOrdersForCurrentMarket = createAppSelector(
  [getSubaccountOrders, getCurrentMarketId],
  (orders, marketId) =>
    orders?.filter(
      (order) =>
        order.status === AbacusOrderStatus.Open && marketId != null && order.marketId === marketId
    )
);

export const getSubaccountOrderSizeBySideAndOrderbookLevel = createAppSelector(
  [getSubaccountOpenOrdersForCurrentMarket, getCurrentMarketOrderbook],
  (openOrders = [], book = undefined) => {
    const tickSize = MustBigNumber(book?.grouping?.tickSize);
    const orderSizeBySideAndPrice: Partial<Record<OrderSide, Record<number, number>>> = {};
    openOrders.forEach((order: SubaccountOrder) => {
      const side = ORDER_SIDES[order.side.name];
      const byPrice = (orderSizeBySideAndPrice[side] ??= {});

      const priceOrderbookLevel = (() => {
        if (tickSize.isEqualTo(0)) {
          return order.price;
        }
        const tickLevelUnrounded = MustBigNumber(order.price).div(tickSize);
        const tickLevel =
          side === OrderSide.BUY
            ? tickLevelUnrounded.decimalPlaces(0, BigNumber.ROUND_FLOOR)
            : tickLevelUnrounded.decimalPlaces(0, BigNumber.ROUND_CEIL);

        return tickLevel.times(tickSize).toNumber();
      })();
      byPrice[priceOrderbookLevel] = (byPrice[priceOrderbookLevel] ?? 0) + order.size;
    });
    return orderSizeBySideAndPrice;
  }
);

/**
 * @param orderId
 * @returns order details with the given orderId
 */
export const getOrderDetails = () =>
  createAppSelector(
    [getSubaccountOrders, getAssets, getPerpetualMarkets, (s, orderId: string) => orderId],
    (orders, assets, perpetualMarkets, orderId) => {
      const matchingOrder = orders?.find((order) => order.id === orderId);
      return matchingOrder
        ? getHydratedTradingData({
            data: matchingOrder,
            assets: assets ?? {},
            perpetualMarkets: perpetualMarkets ?? {},
          })
        : undefined;
    }
  );

/**
 * @param state
 * @returns list of fills for the currently connected subaccount
 */
export const getSubaccountFills = (state: RootState) => state.account.fills;

/**
 * @param state
 * @returns Record of SubaccountFills indexed by marketId
 */
export const getMarketFills = createAppSelector(
  [getSubaccountFills],
  (fills): { [marketId: string]: SubaccountFill[] } => {
    return (fills ?? []).reduce(
      (marketFills, fill) => {
        marketFills[fill.marketId] ??= [];
        marketFills[fill.marketId]!.push(fill);
        return marketFills;
      },
      {} as { [marketId: string]: SubaccountFill[] }
    );
  }
);

/**
 * @param state
 * @returns fill details with the given fillId
 */
export const getFillDetails = () =>
  createAppSelector(
    [getSubaccountFills, getAssets, getPerpetualMarkets, (s, fillId: string) => fillId],
    (fills, assets, perpetualMarkets, fillId) => {
      const matchingFill = fills?.find((fill) => fill.id === fillId);
      return matchingFill
        ? getHydratedTradingData({
            data: matchingFill,
            assets: assets ?? {},
            perpetualMarkets: perpetualMarkets ?? {},
          })
        : undefined;
    }
  );

/**
 * @param state
 * @returns SubaccountFills of the current market
 */
export const getCurrentMarketFills = createAppSelector(
  [getCurrentMarketId, getMarketFills],
  (currentMarketId, marketFills): SubaccountFill[] =>
    !currentMarketId ? [] : marketFills[currentMarketId] ?? []
);

const getFillsForOrderId = createAppSelector(
  [(s, orderId) => orderId, getSubaccountFills],
  (orderId, fills) => (orderId ? groupBy(fills, 'orderId')[orderId] ?? [] : [])
);

/**
 * @returns the average price the order is filled at
 */
export const getAverageFillPriceForOrder = () =>
  createAppSelector([(s, orderId) => getFillsForOrderId(s, orderId)], getAverageFillPrice);

/**
 * @param state
 * @returns list of transfers for the currently connected subaccount
 */
export const getSubaccountTransfers = (state: RootState) => state.account.transfers;

/**
 * @param state
 * @returns list of funding payments for the currently connected subaccount
 */
export const getSubaccountFundingPayments = (state: RootState) => state.account.fundingPayments;

/**
 * @param state
 * @returns Record of SubaccountFundingPayments indexed by marketId
 */
export const getMarketFundingPayments = createAppSelector(
  [getSubaccountFundingPayments],
  (fundingPayments): { [marketId: string]: SubaccountFundingPayment[] } => {
    return (fundingPayments ?? []).reduce(
      (marketFundingPayments, fundingPayment) => {
        marketFundingPayments[fundingPayment.marketId] ??= [];
        marketFundingPayments[fundingPayment.marketId]!.push(fundingPayment);
        return marketFundingPayments;
      },
      {} as { [marketId: string]: SubaccountFundingPayment[] }
    );
  }
);

/**
 * @param state
 * @returns SubaccountFundingPayments of the current market
 */
export const getCurrentMarketFundingPayments = createAppSelector(
  [getCurrentMarketId, getMarketFundingPayments],
  (currentMarketId, marketFundingPayments): SubaccountFundingPayment[] =>
    !currentMarketId ? [] : marketFundingPayments[currentMarketId] ?? []
);

/**
 * @param state
 * @returns boolean on whether an order status is considered open
 */
const isOpenOrderStatus = (status: AbacusOrderStatuses) => !isOrderStatusClearable(status);

/**
 * @param state
 * @returns Whether there are unseen fill updates
 */
export const getHasUnseenFillUpdates = (state: RootState) =>
  Object.keys(state.account.unseenFillsCountPerMarket).length > 0;

/**
 * @param state
 * @returns get unseen fills count per market
 */
const getUnseenFillsCountPerMarket = (state: RootState) => state.account.unseenFillsCountPerMarket;

/**
 * @param state
 * @returns get unseen fills count for current market
 */
const getUnseenFillsCountForMarket = createAppSelector(
  [getUnseenFillsCountPerMarket, getCurrentMarketId],
  (unseenFillsCountPerMarket, marketId) => (marketId ? unseenFillsCountPerMarket[marketId] ?? 0 : 0)
);

/**
 * @param state
 * @returns get unseen fills count for current market
 */
const getAllUnseenFillsCount = createAppSelector(
  [getUnseenFillsCountPerMarket],
  (unseenFillsCountPerMarket) => sum(Object.values(unseenFillsCountPerMarket))
);

/**
 * @param state
 * @returns Total numbers of the subaccount's open positions, open orders and unseen fills
 */
export const getTradeInfoNumbers = createAppSelector(
  [
    getExistingOpenPositions,
    getSubaccountOrders,
    getAllUnseenFillsCount,
    getSubaccountFundingPayments,
  ],
  (positions, orders, unseenFillsCount, fundingPayments) => ({
    numTotalPositions: positions?.length,
    numTotalOpenOrders: orders?.filter((order) => isOpenOrderStatus(order.status)).length,
    numTotalUnseenFills: unseenFillsCount,
    numTotalFundingPayments: fundingPayments?.length,
  })
);

/**
 * @param state
 * @returns Numbers of the subaccount's open orders and unseen fills of the current market
 */
export const getCurrentMarketTradeInfoNumbers = createAppSelector(
  [getCurrentMarketOrders, getUnseenFillsCountForMarket, getCurrentMarketFundingPayments],
  (marketOrders, marketUnseenFillsCount, marketFundingPayments) => {
    return {
      numOpenOrders: marketOrders.filter((order) => isOpenOrderStatus(order.status)).length,
      numUnseenFills: marketUnseenFillsCount,
      numFundingPayments: marketFundingPayments.length,
    };
  }
);

/**
 * @param state
 * @returns user's OnboardingState
 */
export const getOnboardingState = (state: RootState) => state.account.onboardingState;

/**
 * @param state
 * @returns whether an account is connected
 */
export const getIsAccountConnected = (state: RootState) =>
  getOnboardingState(state) === OnboardingState.AccountConnected;

/**
 * @param state
 * @returns OnboardingGuards (Record of boolean items) to aid in determining what Onboarding Step the user is on.
 */
export const getOnboardingGuards = (state: RootState) => state.account.onboardingGuards;

/**
 * @param state
 * @returns Whether there are unseen order updates
 */
export const getHasUnseenOrderUpdates = (state: RootState) => state.account.hasUnseenOrderUpdates;

/**
 * @returns Fee tier id of the current user
 */
export const getUserFeeTier = (state: RootState) => state.account.wallet?.user?.feeTierId;

/**
 * @returns user stats of the current user
 */
export const getUserStats = (state: RootState) => ({
  makerVolume30D: state.account.wallet?.user?.makerVolume30D,
  takerVolume30D: state.account.wallet?.user?.takerVolume30D,
});

/**
 * @returns user wallet balances
 */
export const getBalances = (state: RootState) => state.account.balances;

/**
 *  @returns user wallet staking balances
 * */
export const getStakingBalances = (state: RootState) => state.account.stakingBalances;

/**
 *  @returns user wallet staking delegations
 * */
export const getStakingDelegations = (state: RootState) => state.account.stakingDelegations;

/**
 *  @returns user unbonding delegations
 * */
export const getUnbondingDelegations = (state: RootState) => state.account.unbondingDelegations;

/**
 *  @returns user staking rewards
 * */
export const getStakingRewards = (state: RootState) => state.account.stakingRewards;

/**
 * @returns account all time trading rewards
 */
export const getTotalTradingRewards = (state: RootState) => state.account.tradingRewards?.total;

/**
 * @returns account trading rewards aggregated by period
 */
export const getHistoricalTradingRewards = (state: RootState) =>
  state.account.tradingRewards?.filledHistory;

/**
 * @returns account historical trading rewards for the specified perid
 */
export const getTradingRewardsEventsForPeriod = () =>
  createAppSelector(
    [(state: RootState) => state.account.tradingRewards?.rawHistory, (s, period: string) => period],
    (historicalTradingRewards, period) => historicalTradingRewards?.get(period)?.toArray()
  );

/**
 * @returns account historical trading rewards for the specified perid
 */
export const getHistoricalTradingRewardsForPeriod = () =>
  createAppSelector(
    [getHistoricalTradingRewards, (s, period: string) => period],
    (historicalTradingRewards, period) => historicalTradingRewards?.get(period)?.toArray()
  );

const historicalRewardsForCurrentWeekSelector = getHistoricalTradingRewardsForPeriod();
/**
 * @returns account historical trading rewards for the current week
 */
export const getHistoricalTradingRewardsForCurrentWeek = createAppSelector(
  [(s) => historicalRewardsForCurrentWeekSelector(s, HistoricalTradingRewardsPeriod.WEEKLY.name)],
  (historicalTradingRewards) => historicalTradingRewards?.[0]
);

/**
 * @returns UsageRestriction of the current session
 */
export const getUsageRestriction = (state: RootState) => state.account.restriction;

/**
 * @returns RestrictionType from the current session
 */
export const getRestrictionType = (state: RootState) => state.account.restriction?.restriction;

/**
 * @returns compliance status of the current session
 */
export const getComplianceStatus = (state: RootState) => state.account.compliance?.status;

/**
 * @returns compliance status of the current session
 */
export const getComplianceUpdatedAt = (state: RootState) => state.account.compliance?.updatedAt;

/**
 * @returns compliance geo of the current session
 */
export const getGeo = (state: RootState) => state.account.compliance?.geo;

export const getUserWalletAddress = (state: RootState) => state.account.wallet?.walletAddress;

export const getUserSubaccountNumber = (state: RootState) =>
  state.account.subaccount?.subaccountNumber;

export const getAccountUiMemory = (state: RootState) => state.accountUiMemory;
export const getCurrentAccountMemory = createAppSelector(
  [getSelectedNetwork, getUserWalletAddress, getAccountUiMemory],
  (networkId, walletId, memory) => memory[walletId ?? '']?.[networkId]
);

export const createGetUnseenOrdersCount = () =>
  createAppSelector(
    [
      getCurrentAccountMemory,
      BonsaiCore.network.indexerHeight.data,
      getSubaccountOrders,
      (state, market: string | undefined) => market,
    ],
    (memory, height, orders, market) => {
      if (height == null) {
        return 0;
      }
      const ourOrders =
        (market == null ? orders : orders?.filter((o) => o.marketId === market)) ?? EMPTY_ARR;
      if (ourOrders.length === 0) {
        return 0;
      }
      if (memory == null) {
        return ourOrders.length;
      }
      const unseen = ourOrders.filter(
        (o) =>
          (o.updatedAtMilliseconds ?? 0) >
          (mapIfPresent(
            (memory.seenOpenOrders[o.marketId] ?? memory.seenOpenOrders[ALL_MARKETS_STRING])?.time,
            (t) => new Date(t).valueOf()
          ) ?? 0)
      );
      return unseen.length;
    }
  );

export const createGetUnseenFillsCount = () =>
  createAppSelector(
    [
      getCurrentAccountMemory,
      BonsaiCore.network.indexerHeight.data,
      BonsaiCore.account.fills.data,
      (state, market: string | undefined) => market,
    ],
    (memory, height, fills, market) => {
      if (height == null) {
        return 0;
      }
      const ourFills = market == null ? fills : fills.filter((o) => o.market === market);
      if (ourFills.length === 0) {
        return 0;
      }
      if (memory == null) {
        return ourFills.length;
      }
      const unseen = ourFills.filter(
        (o) =>
          (mapIfPresent(o.createdAt, (c) => new Date(c).valueOf()) ?? 0) >
          (mapIfPresent(
            (memory.seenFills[o.market ?? ''] ?? memory.seenFills[ALL_MARKETS_STRING])?.time,
            (t) => new Date(t).valueOf()
          ) ?? 0)
      );
      return unseen.length;
    }
  );
