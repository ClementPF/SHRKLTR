import { api } from './client';
import type {
  AchievementUnlock,
  AppInvite,
  AppInvitePreview,
  Challenge,
  ChallengeResponse,
  ChallengeStatus,
  ClaimPreview,
  CreateChallengeRequest,
  CreateGroupInviteRequest,
  CreatePlaceholderRequest,
  CreateTournamentRequest,
  Game,
  GameShare,
  GoogleCodeExchangeRequest,
  Group,
  GroupInvite,
  GroupInvitePreview,
  GroupJoinResult,
  GroupMember,
  GroupPlayer,
  InboxNotification,
  IssuedGroupInvite,
  JoinGroupRequest,
  InvitedPlayer,
  NotificationPreferences,
  PageParams,
  PlaceholderClaimLink,
  RegisterPushDeviceRequest,
  RivalryStats,
  SessionResponse,
  Sport,
  Stats,
  SubmitGameRequest,
  Tournament,
  UnreadCount,
  UpdateMeRequest,
  UpdateNotificationPreferencesRequest,
  UpdateTournamentRequest,
  User,
  UserAchievement,
} from './types';

const seg = encodeURIComponent;

// Auth (unauthenticated routes: no Bearer, no refresh-on-401)
export const exchangeGoogleCode = ({
  code,
  codeVerifier,
  redirectUri,
  claimToken,
}: GoogleCodeExchangeRequest) =>
  api.post<SessionResponse>(
    '/auth/google/code',
    claimToken
      ? { code, codeVerifier, redirectUri, claimToken }
      : { code, codeVerifier, redirectUri },
    { auth: false },
  );

export const logoutSession = (refreshToken: string) =>
  api.post<void>('/auth/logout', { refreshToken }, { auth: false });

// Users
export const listUsers = () => api.get<User[]>('/users');
export const getMe = () => api.get<User>('/users/me');
export const updateMe = (body: UpdateMeRequest) => api.put<User>('/users/me', body);
export const getUser = (username: string) => api.get<User>(`/users/${seg(username)}`);
export const getUserTournaments = (username: string) =>
  api.get<Tournament[]>(`/users/${seg(username)}/tournaments`);
export const getUserStats = (username: string) => api.get<Stats[]>(`/users/${seg(username)}/stats`);
export const getUserRivalries = (username: string, tournamentName?: string) =>
  api.get<RivalryStats[]>(`/users/${seg(username)}/rivalries`, { query: { tournamentName } });
export const getUserGames = (
  username: string,
  params: PageParams & { tournamentName?: string } = {},
  signal?: AbortSignal,
) => api.get<Game[]>(`/users/${seg(username)}/games`, { query: { ...params }, signal });

// Placeholders and invitations
export const createPlaceholder = (body: CreatePlaceholderRequest) =>
  api.post<PlaceholderClaimLink>('/players/placeholders', body);
export const listInvitedPlayers = () => api.get<InvitedPlayer[]>('/players/invited');
export const reissueClaimLink = (placeholderId: string) =>
  api.post<PlaceholderClaimLink>(`/players/${seg(placeholderId)}/claim-link`, {});
export const revokeClaimLink = (placeholderId: string) =>
  api.delete<void>(`/players/${seg(placeholderId)}/claim-link`);
export const getClaimPreview = (token: string) =>
  api.get<ClaimPreview>(`/invites/claim/${seg(token)}`, { auth: false });
export const issueAppInvite = () => api.post<AppInvite>('/invites/app', {});
export const getAppInvitePreview = (token: string) =>
  api.get<AppInvitePreview>(`/invites/app/${seg(token)}`, { auth: false });

// Sports
export const listSports = () => api.get<Sport[]>('/sports');
export const createSport = (name: string) => api.post<Sport>('/sports', { name });

// Tournaments
export const listTournaments = (sport?: string) =>
  api.get<Tournament[]>('/tournaments', { query: { sport } });
export const createTournament = (body: CreateTournamentRequest) =>
  api.post<Tournament>('/tournaments', body);
export const getTournament = (name: string) => api.get<Tournament>(`/tournaments/${seg(name)}`);
export const updateTournament = (name: string, body: UpdateTournamentRequest) =>
  api.put<Tournament>(`/tournaments/${seg(name)}`, body);
export const deleteTournament = (name: string) => api.delete<void>(`/tournaments/${seg(name)}`);
export const getTournamentUsers = (name: string) =>
  api.get<User[]>(`/tournaments/${seg(name)}/users`);
export const getTournamentStats = (name: string) =>
  api.get<Stats[]>(`/tournaments/${seg(name)}/stats`);
export const getTournamentRivalries = (
  name: string,
  filter: { userName?: string; rivalName?: string } = {},
) => api.get<RivalryStats[]>(`/tournaments/${seg(name)}/rivalries`, { query: { ...filter } });
export const getTournamentGames = (name: string, params: PageParams = {}) =>
  api.get<Game[]>(`/tournaments/${seg(name)}/games`, { query: { ...params } });
export const submitGame = (name: string, body: SubmitGameRequest) =>
  api.post<Game>(`/tournaments/${seg(name)}/games`, body);

// Games
export const getGame = (id: string, signal?: AbortSignal) =>
  api.get<Game>(`/games/${seg(id)}`, { signal });
export const issueGameShare = (gameId: string) =>
  api.post<GameShare>(`/games/${seg(gameId)}/share`, {});
export const revokeGameShare = (gameId: string, shareId: string) =>
  api.delete<void>(`/games/${seg(gameId)}/share/${seg(shareId)}`);

// Stats lookups
export const getStats = (userName: string, tournamentName: string) =>
  api.get<Stats>('/stats', { query: { userName, tournamentName } });
export const getRivalries = (userName: string, tournamentName: string) =>
  api.get<RivalryStats[]>('/rivalries', { query: { userName, tournamentName } });
export const getRivalry = (userName: string, rivalName: string, tournamentName: string) =>
  api.get<RivalryStats>('/rivalry', { query: { userName, rivalName, tournamentName } });

// Challenges
export const listChallenges = (
  params: PageParams & { status?: readonly ChallengeStatus[] } = {},
  signal?: AbortSignal,
) =>
  api.get<Challenge[]>('/challenges', {
    query: { page: params.page, pageSize: params.pageSize, status: params.status?.join(',') },
    signal,
  });
export const createChallenge = (body: CreateChallengeRequest) =>
  api.post<Challenge>('/challenges', body);
export const getChallenge = (id: string, signal?: AbortSignal) =>
  api.get<Challenge>(`/challenges/${seg(id)}`, { signal });
export const respondToChallenge = (id: string, response: ChallengeResponse) =>
  api.put<Challenge>(`/challenges/${seg(id)}/response`, { response });

// Notifications
export const listNotifications = (params: PageParams & { unreadOnly?: boolean } = {}) =>
  api.get<InboxNotification[]>('/notifications', { query: { ...params } });
export const getUnreadNotificationCount = () => api.get<UnreadCount>('/notifications/unread-count');
export const markNotificationRead = (id: string) =>
  api.put<InboxNotification>(`/notifications/${seg(id)}/read`, {});
export const markAllNotificationsRead = () => api.post<void>('/notifications/read-all', {});
export const getNotificationPreferences = () =>
  api.get<NotificationPreferences>('/users/me/notification-preferences');
export const updateNotificationPreferences = (body: UpdateNotificationPreferencesRequest) =>
  api.put<NotificationPreferences>('/users/me/notification-preferences', body);
export const registerPushDevice = (body: RegisterPushDeviceRequest) =>
  api.post<void>('/users/me/push-devices', body);
export const unregisterPushDevice = (installationId: string) =>
  api.delete<void>(`/users/me/push-devices/${seg(installationId)}`);

// Achievements
export const getUserAchievements = (username: string) =>
  api.get<UserAchievement[]>(`/users/${seg(username)}/achievements`);
export const getRecentAchievements = (params: PageParams = {}) =>
  api.get<AchievementUnlock[]>('/achievements/recent', { query: { ...params } });

// Groups
export const listGroups = () => api.get<Group[]>('/groups');
export const createGroup = (name: string) => api.post<Group>('/groups', { name });
export const getGroup = (id: string) => api.get<Group>(`/groups/${seg(id)}`);
export const renameGroup = (id: string, name: string) =>
  api.put<Group>(`/groups/${seg(id)}`, { name });
export const listGroupMembers = (id: string, params: PageParams = {}) =>
  api.get<GroupMember[]>(`/groups/${seg(id)}/members`, { query: { ...params } });
export const setGroupMemberRole = (id: string, userId: string, role: 'ADMIN' | 'MEMBER') =>
  api.put<GroupMember>(`/groups/${seg(id)}/members/${seg(userId)}`, { role });
export const removeGroupMember = (id: string, userId: string) =>
  api.delete<void>(`/groups/${seg(id)}/members/${seg(userId)}`);
export const transferGroupOwnership = (id: string, userId: string) =>
  api.post<Group>(`/groups/${seg(id)}/transfer-owner`, { userId });
export const leaveGroup = (id: string) => api.post<void>(`/groups/${seg(id)}/leave`, {});
export const listGroupTournaments = (id: string) =>
  api.get<Tournament[]>(`/groups/${seg(id)}/tournaments`);
export const listGroupPlayers = (id: string) =>
  api.get<GroupPlayer[]>(`/groups/${seg(id)}/players`);
export const addGroupPlayer = (id: string, placeholderUserId: string) =>
  api.post<GroupPlayer>(`/groups/${seg(id)}/players`, { placeholderUserId });
export const listGroupInvites = (id: string) =>
  api.get<GroupInvite[]>(`/groups/${seg(id)}/invites`);
export const createGroupInvite = (id: string, body: CreateGroupInviteRequest = {}) =>
  api.post<IssuedGroupInvite>(`/groups/${seg(id)}/invites`, body);
export const revokeGroupInvite = (id: string, inviteId: string) =>
  api.delete<void>(`/groups/${seg(id)}/invites/${seg(inviteId)}`);
export const getGroupInvitePreview = (token: string) =>
  api.get<GroupInvitePreview>(`/invites/group/${seg(token)}`, { auth: false });
export const joinGroup = (body: JoinGroupRequest) =>
  api.post<GroupJoinResult>('/groups/join', body);
