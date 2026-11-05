import { api } from './client';
import type {
  AppInvite,
  AppInvitePreview,
  ClaimPreview,
  CreatePlaceholderRequest,
  CreateTournamentRequest,
  Game,
  GoogleCodeExchangeRequest,
  InvitedPlayer,
  PageParams,
  PlaceholderClaimLink,
  RivalryStats,
  SessionResponse,
  Sport,
  Stats,
  SubmitGameRequest,
  Tournament,
  UpdateMeRequest,
  UpdateTournamentRequest,
  User,
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
export const registerPushToken = (value: string) =>
  api.post<void>('/users/me/push-token', { value });
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
export const challengeUser = (username: string, message?: string) =>
  api.post<void>(`/users/${seg(username)}/challenge`, message ? { message } : {});

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

// Stats lookups
export const getStats = (userName: string, tournamentName: string) =>
  api.get<Stats>('/stats', { query: { userName, tournamentName } });
export const getRivalries = (userName: string, tournamentName: string) =>
  api.get<RivalryStats[]>('/rivalries', { query: { userName, tournamentName } });
export const getRivalry = (userName: string, rivalName: string, tournamentName: string) =>
  api.get<RivalryStats>('/rivalry', { query: { userName, rivalName, tournamentName } });
