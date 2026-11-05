/** Custom URL scheme registered as `expo.scheme` in app.json. */
export const APP_SCHEME = 'com.elo.sharkulator';

export type AppSchemeUrl = `${typeof APP_SCHEME}://${string}`;

/** URL that opens `path` in the installed app through the custom scheme (no universal links). */
export function appSchemeUrl(path: string): AppSchemeUrl {
  return `${APP_SCHEME}://${path.startsWith('/') ? path : `/${path}`}`;
}

export function claimInviteAppUrl(token: string): AppSchemeUrl {
  return appSchemeUrl(`/invite/claim/${encodeURIComponent(token)}`);
}

export function appInviteAppUrl(token: string): AppSchemeUrl {
  return appSchemeUrl(`/invite/app/${encodeURIComponent(token)}`);
}
