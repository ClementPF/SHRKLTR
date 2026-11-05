// Mirrors the backend zod DTOs in apps/backend/src/lib/serializers.ts and route schemas.

export type GameResult = 'WIN' | 'TIE' | 'LOSS';

/** PLACEHOLDER players were added by name and have not claimed their profile yet. */
export type AccountType = 'REGISTERED' | 'PLACEHOLDER';

export interface User {
  id: string;
  username: string;
  accountType: AccountType;
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
  /** Signed Elo change from this game. */
  scoreValue: number;
  /** Tournament rating just before the game; null for games recorded before it was tracked. */
  ratingBefore: number | null;
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

/** Body of POST /auth/google/code; the backend redeems the code at Google. */
export interface GoogleCodeExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  /** Claims a placeholder; only accepted for a Google account that is new to Sharkulator. */
  claimToken?: string;
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

export interface CreatePlaceholderRequest {
  displayName: string;
}

/** POST /players/placeholders and POST /players/:id/claim-link. claimUrl is only ever issued here. */
export interface PlaceholderClaimLink {
  user: User;
  claimUrl: string;
  /** ISO-8601 UTC timestamp. */
  claimExpiresAt: string;
}

export type InvitedPlayerStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CLAIMED';

/** GET /players/invited row: lifecycle metadata only, never the claim token. */
export interface InvitedPlayer {
  user: User;
  status: InvitedPlayerStatus;
  claimExpiresAt: string;
  claimRevokedAt: string | null;
  claimedAt: string | null;
}

/** Public GET /invites/claim/:token. */
export interface ClaimPreview {
  player: User;
  invitedBy: User | null;
  expiresAt: string;
  /** Games played in open tournaments. */
  gamesCount: number;
  recentGames: Game[];
  stats: Stats[];
}

/** POST /invites/app: the caller's reusable invitation link, returned only when issued. */
export interface AppInvite {
  url: string;
}

/** Public GET /invites/app/:token. */
export interface AppInvitePreview {
  invitedBy: User;
}
