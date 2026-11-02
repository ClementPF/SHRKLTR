import { apiLocation, versionLabel } from '@/lib/app-info';

describe('app info', () => {
  it.each([
    'http://localhost:3100',
    'http://127.0.0.1:3100',
    'http://192.168.1.20:3100',
    'http://10.0.0.4:3100',
    'http://172.20.1.1:3100',
    'http://my-mac.local:3100',
  ])('marks %s as a local API', (url) => {
    expect(apiLocation(url)).toBe('L');
  });

  it.each(['https://api.sharkulator.app', 'http://172.40.0.1', 'not a url'])(
    'marks %s as remote',
    (url) => {
      expect(apiLocation(url)).toBe('R');
    },
  );

  it('formats the legacy version label', () => {
    expect(versionLabel('1.2.3', 'http://localhost:3100')).toBe('Version : 1.2.3 L');
    expect(versionLabel('1.2.3', 'https://api.example.com')).toBe('Version : 1.2.3 R');
  });
});
