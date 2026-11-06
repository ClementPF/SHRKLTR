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
  /** Owning group of a members-only tournament; null for open tournaments. */
  group?: TournamentGroup | null;
}

export interface TournamentGroup {
  id: string;
  name: string;
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

/** My public link for a game (POST /games/:id/share returns the active one or issues it). */
export interface GameShare {
  shareId: string;
  /** Public result page: PUBLIC_API_URL/s/<token>. */
  url: string;
  /** 1200×630 PNG card: PUBLIC_API_URL/s/<token>.png. */
  imageUrl: string;
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
  /** Creates a members-only tournament in this group; requires OWNER or ADMIN. */
  groupId?: string;
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
  /** Adds the placeholder to this group's unclaimed players; requires membership. */
  groupId?: string;
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

export type NotificationCategory = 'games' | 'challenges' | 'achievements' | 'claims' | 'groups';

export type NotificationType =
  | 'game_recorded'
  | 'challenge_received'
  | 'challenge_accepted'
  | 'challenge_declined'
  | 'challenge_expiring'
  | 'challenge_expired'
  | 'achievement_unlocked'
  | 'placeholder_claimed'
  | 'group_member_joined';

/** Screen a notification opens; also the `target` of a push payload's data. */
export type NotificationTarget =
  | { type: 'game'; gameId: string }
  | { type: 'challenge'; challengeId: string }
  | { type: 'group'; groupId: string }
  | { type: 'achievements'; username: string }
  | { type: 'user'; username: string };

/** GET /notifications row. Named to avoid the DOM's global Notification. */
export interface InboxNotification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  /** Null when the source no longer exists. */
  target: NotificationTarget | null;
  actor: User | null;
  /** ISO-8601 UTC timestamp. */
  createdAt: string;
  readAt: string | null;
}

export interface UnreadCount {
  count: number;
}

/** Push toggles per category; the inbox always records every notification. */
export type NotificationPreferences = Record<NotificationCategory, boolean>;

/** PUT body: at least one category; omitted categories keep their value. */
export type UpdateNotificationPreferencesRequest = Partial<NotificationPreferences>;

export type PushPlatform = 'IOS' | 'ANDROID' | 'UNKNOWN';

export interface RegisterPushDeviceRequest {
  installationId: string;
  expoToken: string;
  platform: PushPlatform;
}

export type AchievementCode =
  | 'first_win'
  | 'win_streak_3'
  | 'win_streak_5'
  | 'win_streak_10'
  | 'games_10'
  | 'games_50'
  | 'games_100'
  | 'giant_killer'
  | 'explorer_3'
  | 'explorer_5'
  | 'first_challenge_won'
  | 'first_group_joined'
  | 'invited_player_claimed';

export interface Achievement {
  code: AchievementCode;
  title: string;
  description: string;
}

export interface AchievementSource {
  type: 'GAME' | 'CHALLENGE' | 'GROUP' | 'CLAIM' | 'BACKFILL';
  /** Null when there is none or the viewer cannot see it. */
  gameId: string | null;
  /** Null when there is none or the viewer is not a member. */
  groupId?: string | null;
  /** Null when there is none or the viewer cannot open that challenge. */
  challengeId?: string | null;
}

/** GET /users/:username/achievements entry: the catalog with this user's unlock state. */
export interface UserAchievement extends Achievement {
  unlocked: boolean;
  unlockedAt: string | null;
  /** Null while locked. */
  source: AchievementSource | null;
}

/** GET /achievements/recent entry: one of the signed-in user's own unlocks. */
export interface AchievementUnlock {
  user: User;
  achievement: Achievement;
  unlockedAt: string;
  source: AchievementSource;
}

export type GroupRole = 'OWNER' | 'ADMIN' | 'MEMBER';

/** GET /groups row and GET /groups/:id: a group with the caller's role. */
export interface Group {
  id: string;
  name: string;
  /** Your role in the group. */
  role: GroupRole;
  memberCount: number;
  createdAt: string;
}

export interface GroupMember {
  user: User;
  role: GroupRole;
  joinedAt: string;
}

/** Unclaimed player on a group roster (a placeholder); never a member. */
export interface GroupPlayer {
  user: User;
  addedBy: User | null;
  addedAt: string;
}

/** POST /groups/:id/invites: url and code are returned only in this response. */
export interface IssuedGroupInvite {
  id: string;
  /** Join link, also the QR payload. */
  url: string;
  /** 10-character short code, case-insensitive. */
  code: string;
  /** Null when the invite never expires. */
  expiresAt: string | null;
  createdAt: string;
}

export type GroupInviteStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/** GET /groups/:id/invites row: metadata only, the link and code cannot be recovered. */
export interface GroupInvite {
  id: string;
  status: GroupInviteStatus;
  createdBy: User | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** Public GET /invites/group/:token. */
export interface GroupInvitePreview {
  groupName: string;
  expiresAt: string | null;
}

/** POST /groups/join: exactly one of token or code. */
export type JoinGroupRequest = { token: string } | { code: string };

export interface GroupJoinResult {
  group: Group;
  role: GroupRole;
  /** False when you were already a member; your role is unchanged. */
  joined: boolean;
}

export interface CreateGroupInviteRequest {
  /** Omit for the default (30 days), null for no expiry. */
  expiresAt?: string | null;
}

export type ChallengeStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED' | 'EXPIRED';

/** GET /challenges row and GET /challenges/:id. */
export interface Challenge {
  id: string;
  tournament: Tournament;
  challenger: User;
  opponent: User;
  /**
   * PENDING until the opponent answers; ACCEPTED until a qualifying game (COMPLETED) or the
   * deadline (EXPIRED); DECLINED, COMPLETED and EXPIRED are final.
   */
  status: ChallengeStatus;
  deadlineAt: string;
  createdAt: string;
  acceptedAt: string | null;
  /** When it was declined, completed or expired. */
  resolvedAt: string | null;
  /** Challenged player on the winning team (COMPLETED). */
  winner: User | null;
  /** Game that completed the challenge; null otherwise or once that game is deleted. */
  gameId: string | null;
}

export interface CreateChallengeRequest {
  tournamentName: string;
  opponentUsername: string;
  /** Between 1 hour and 30 days from now; the server defaults to 7 days. */
  deadlineAt?: string;
}

export type ChallengeResponse = 'ACCEPT' | 'DECLINE';
