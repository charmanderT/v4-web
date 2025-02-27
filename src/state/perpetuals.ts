import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import merge from 'lodash/merge';

import type {
  MarketHistoricalFunding,
  MarketOrderbook,
  MarketTrade,
  Nullable,
  PerpetualMarket,
} from '@/constants/abacus';
import { LaunchMarketStatus } from '@/constants/launchableMarkets';
import { LocalStorageKey } from '@/constants/localStorage';
import { DEFAULT_MARKETID, MarketFilters } from '@/constants/markets';

import { getLocalStorage } from '@/lib/localStorage';
import { processOrderbookToCreateMap } from '@/lib/orderbookHelpers';

export interface PerpetualsState {
  currentMarketId?: string;
  // if user is viewing is a live, tradeable market: its id; otherwise: undefined
  currentMarketIdIfTradeable?: string;
  liveTrades?: Record<string, MarketTrade[]>;
  markets?: Record<string, PerpetualMarket>;
  orderbooks?: Record<string, MarketOrderbook>;
  orderbooksMap?: Record<
    string,
    {
      asks: Record<string, number>;
      bids: Record<string, number>;
    }
  >;
  historicalFundings: Record<string, MarketHistoricalFunding[]>;
  marketFilter: MarketFilters;
  launchMarketIds: string[];
}

const initialState: PerpetualsState = {
  currentMarketId: undefined,
  currentMarketIdIfTradeable: undefined,
  liveTrades: {},
  markets: undefined,
  orderbooks: undefined,
  orderbooksMap: undefined,
  historicalFundings: {},
  marketFilter: MarketFilters.ALL,
  launchMarketIds: [],
};

const MAX_NUM_LIVE_TRADES = 100;

export const perpetualsSlice = createSlice({
  name: 'Perpetuals',
  initialState,
  reducers: {
    setMarketFilter: (state: PerpetualsState, action: PayloadAction<MarketFilters>) => {
      state.marketFilter = action.payload;
    },
    setCurrentMarketId: (state: PerpetualsState, action: PayloadAction<string>) => {
      state.currentMarketId = action.payload;
    },
    setCurrentMarketIdIfTradeable: (
      state: PerpetualsState,
      action: PayloadAction<string | undefined>
    ) => {
      state.currentMarketIdIfTradeable = action.payload;
    },
    setLiveTrades: (
      state: PerpetualsState,
      action: PayloadAction<{ trades: MarketTrade[]; marketId: string }>
    ) => ({
      ...state,
      liveTrades: merge({}, state.liveTrades, {
        [action.payload.marketId]: action.payload.trades.slice(0, MAX_NUM_LIVE_TRADES),
      }),
    }),
    setMarkets: (
      state: PerpetualsState,
      action: PayloadAction<{ markets: Record<string, PerpetualMarket>; update?: boolean }>
    ) => ({
      ...state,
      markets: action.payload.update
        ? merge({}, state.markets, action.payload.markets)
        : action.payload.markets,
    }),
    setOrderbook: (
      state: PerpetualsState,
      action: PayloadAction<{ orderbook?: Nullable<MarketOrderbook>; marketId: string }>
    ) => {
      state.orderbooks = merge({}, state.orderbooks, {
        [action.payload.marketId]: action.payload.orderbook,
      });

      const { newAsks, newBids } = processOrderbookToCreateMap({
        orderbookMap: state.orderbooksMap?.[action.payload.marketId],
        newOrderbook: action.payload.orderbook,
      });

      state.orderbooksMap = {
        ...(state.orderbooksMap ?? {}),
        [action.payload.marketId]: {
          asks: newAsks,
          bids: newBids,
        },
      };
    },
    setHistoricalFundings: (
      state: PerpetualsState,
      action: PayloadAction<{ historicalFundings: MarketHistoricalFunding[]; marketId: string }>
    ) => {
      state.historicalFundings[action.payload.marketId] = action.payload.historicalFundings;
    },
    resetPerpetualsState: () =>
      ({
        ...initialState,
        currentMarketId:
          getLocalStorage({ key: LocalStorageKey.LastViewedMarket }) ?? DEFAULT_MARKETID,
      }) satisfies PerpetualsState,
    setLaunchMarketIds: (
      state: PerpetualsState,
      action: PayloadAction<{ launchedMarketId: string; launchStatus: LaunchMarketStatus }>
    ) => {
      const { launchedMarketId, launchStatus } = action.payload;
      if (launchStatus === LaunchMarketStatus.PENDING) {
        state.launchMarketIds = [...state.launchMarketIds, launchedMarketId];
      } else {
        state.launchMarketIds = state.launchMarketIds.filter((id) => id !== launchedMarketId);
      }
    },
  },
});

export const {
  setCurrentMarketId,
  setCurrentMarketIdIfTradeable,
  setLiveTrades,
  setMarkets,
  setOrderbook,
  setHistoricalFundings,
  resetPerpetualsState,
  setMarketFilter,
  setLaunchMarketIds,
} = perpetualsSlice.actions;
