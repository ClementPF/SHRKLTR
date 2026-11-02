import { router } from 'expo-router';
import type { ReactElement } from 'react';

import type { Game, RivalryStats, Stats } from '@/api/types';
import { GameRow } from '@/components/game-row';
import { RivalryCard } from '@/components/rivalry-card';
import { RivalryDonut } from '@/components/rivalry-donut';
import { StatsCard } from '@/components/stats-card';
import type { DonutSlice } from '@/lib/rivalries';

/** A history entry is either a played game or a rivalry summary card. */
export type HistoryItem = Game | RivalryStats;

export function isGame(item: HistoryItem): item is Game {
  return 'outcomes' in item;
}

export type ListItem =
  | { kind: 'stats'; key: string; stats: Stats; linkTo?: string }
  | { kind: 'history'; key: string; item: HistoryItem }
  | { kind: 'donut'; key: string; slices: DonutSlice[] }
  | { kind: 'node'; key: string; node: ReactElement };

export function statsItems(stats: readonly Stats[], linkTo?: string): ListItem[] {
  return stats.map((s) => ({ kind: 'stats', key: `stats-${s.id}`, stats: s, linkTo }));
}

export function historyItems(items: readonly HistoryItem[]): ListItem[] {
  return items.map((item) => ({ kind: 'history', key: `history-${item.id}`, item }));
}

export function openUserDetail(username: string, tournamentName: string) {
  router.push({ pathname: '/user/[username]', params: { username, tournamentName } });
}

export function renderListItem(item: ListItem, viewer: string | undefined): ReactElement {
  switch (item.kind) {
    case 'stats': {
      const { stats, linkTo } = item;
      return (
        <StatsCard
          stats={stats}
          onPress={
            linkTo ? () => openUserDetail(stats.user.username, stats.tournament.name) : undefined
          }
        />
      );
    }
    case 'history':
      return isGame(item.item) ? (
        <GameRow game={item.item} viewer={viewer} />
      ) : (
        <RivalryCard rivalry={item.item} />
      );
    case 'donut':
      return <RivalryDonut slices={item.slices} testID={item.key} />;
    case 'node':
      return item.node;
  }
}
