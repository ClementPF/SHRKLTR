// Mirrors the backend zod DTOs in apps/backend/src/lib/serializers.ts and route schemas.

export type GameResult = 'WIN' | 'TIE' | 'LOSS';

export interface User {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  pictureUrl: string | null;
  locale: string | null;
}

export interface Sport {
  id: string;
  name: string;
}

export interface Tournament {
  id: string;
  name: string;
  displayName: string;
  isOver: boolean;
  sport: Sport;
  owner: User | null;
}

export interface Outcome {
  id: string;
  result: GameResult;
  scoreValue: number;
  user: User;
}

export interface Game {
  id: string;
  /** ISO-8601 UTC timestamp. */
  date: string;
  tournament: Tournament;
  outcomes: Outcome[];
}

export interface StatFields {
  score: number;
  bestScore: number;
  worstScore: number;
  gameCount: number;
  winCount: number;
  loseCount: number;
  tieCount: number;
  winStreak: number;
  loseStreak: number;
  tieStreak: number;
  longestWinStreak: number;
  longestLoseStreak: number;
  longestTieStreak: number;
}

export interface RivalryStats extends StatFields {
  id: string;
  user: User;
  rival: User;
  tournament: Tournament;
}

export interface Stats extends StatFields {
  id: string;
  user: User;
  tournament: Tournament;
  bestRivalry: RivalryStats | null;
  worstRivalry: RivalryStats | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SessionResponse extends TokenPair {
  user: User;
}

export interface ErrorEnvelope {
  error: { code: string; message: string };
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}

export interface UpdateMeRequest {
  firstName?: string;
  lastName?: string;
  locale?: string | null;
  pictureUrl?: string | null;
}

export interface CreateTournamentRequest {
  displayName: string;
  sportName: string;
}

export interface UpdateTournamentRequest {
  displayName?: string;
  isOver?: boolean;
}

export interface SubmitGameRequest {
  outcomes: { username: string; result: GameResult }[];
}
