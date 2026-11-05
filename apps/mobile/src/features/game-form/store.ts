import { create } from 'zustand';

import type { Tournament } from '@/api/types';
import { applyScan, seedOutcomes, type ScanResult, type ScannedOutcome } from '@/lib/qr';

interface GameFormState {
  /** Player the draft belongs to; a different signed-in player starts a fresh draft. */
  owner: string | null;
  tournament: Tournament | null;
  outcomes: ScannedOutcome[];
  start(owner: string): void;
  /** Picking another tournament drops the scans made for the previous one. */
  selectTournament(tournament: Tournament): void;
  scan(raw: string): ScanResult | null;
  /** Adds a player picked or created without scanning; repeated players are ignored. */
  addPlayer(outcome: ScannedOutcome): 'added' | 'duplicate';
  resetOutcomes(): void;
}

export const useGameFormStore = create<GameFormState>((set, get) => ({
  owner: null,
  tournament: null,
  outcomes: [],
  start: (owner) => {
    if (get().owner === owner) return;
    set({ owner, tournament: null, outcomes: seedOutcomes(owner) });
  },
  selectTournament: (tournament) => {
    const { owner } = get();
    set({ tournament, outcomes: owner ? seedOutcomes(owner) : [] });
  },
  scan: (raw) => {
    const { tournament, outcomes } = get();
    if (!tournament) return null;
    const result = applyScan(outcomes, raw, tournament.name);
    if (result.status === 'added') set({ outcomes: result.outcomes });
    return result;
  },
  addPlayer: (outcome) => {
    const { outcomes } = get();
    if (outcomes.some((o) => o.username === outcome.username)) return 'duplicate';
    set({ outcomes: [...outcomes, outcome] });
    return 'added';
  },
  resetOutcomes: () => {
    const { owner } = get();
    set({ outcomes: owner ? seedOutcomes(owner) : [] });
  },
}));
