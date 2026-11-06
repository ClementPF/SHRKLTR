import { APP_SCHEME, appInviteAppUrl, appSchemeUrl, claimInviteAppUrl } from '@/lib/app-links';

import appJson from '../app.json';

describe('custom-scheme app links', () => {
  it('uses the scheme registered in app.json', () => {
    expect(APP_SCHEME).toBe(appJson.expo.scheme);
    expect(APP_SCHEME).toBe('com.elo.sharkulator');
  });

  it('builds claim and app-invite URLs that keep the web path and token', () => {
    expect(claimInviteAppUrl('AbC-123_xyz')).toBe(
      'com.elo.sharkulator:///invite/claim/AbC-123_xyz',
    );
    expect(appInviteAppUrl('AbC-123_xyz')).toBe('com.elo.sharkulator:///invite/app/AbC-123_xyz');
  });

  it('keeps a token inside its path segment', () => {
    expect(claimInviteAppUrl('a/b?c#d')).toBe('com.elo.sharkulator:///invite/claim/a%2Fb%3Fc%23d');
  });

  it('accepts paths with or without a leading slash', () => {
    expect(appSchemeUrl('/feed')).toBe('com.elo.sharkulator:///feed');
    expect(appSchemeUrl('feed')).toBe('com.elo.sharkulator:///feed');
  });
});
