import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';

import { copyText } from '@/lib/clipboard';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const setString = jest.mocked(Clipboard.setStringAsync);

interface FakeBrowser {
  writeText?: jest.Mock;
  execCommand: jest.Mock;
  appendChild: jest.Mock;
  removeChild: jest.Mock;
  field: { value: string; select: jest.Mock };
}

const originals = new Map<string, PropertyDescriptor | undefined>();
function stubGlobal(name: 'navigator' | 'document', value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** Installs a minimal browser clipboard surface (async API + legacy execCommand). */
function fakeBrowser(options: {
  writeText?: () => Promise<void>;
  execCommand: () => boolean;
}): FakeBrowser {
  const field = { value: '', select: jest.fn(), setAttribute: jest.fn(), style: {} };
  const fake: FakeBrowser = {
    writeText: options.writeText ? jest.fn(options.writeText) : undefined,
    execCommand: jest.fn(options.execCommand),
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    field,
  };
  stubGlobal('navigator', fake.writeText ? { clipboard: { writeText: fake.writeText } } : {});
  stubGlobal('document', {
    body: { appendChild: fake.appendChild, removeChild: fake.removeChild },
    createElement: jest.fn(() => field),
    execCommand: fake.execCommand,
  });
  return fake;
}

afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originals.clear();
  jest.restoreAllMocks();
});

describe('copyText on web', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
  });

  it('reports success when the async clipboard accepts the text', async () => {
    const browser = fakeBrowser({ writeText: async () => undefined, execCommand: () => false });
    await expect(copyText('http://x/invite/app/1')).resolves.toBe(true);
    expect(browser.writeText).toHaveBeenCalledWith('http://x/invite/app/1');
    expect(browser.execCommand).not.toHaveBeenCalled();
  });

  it('reports failure when writeText is denied and the legacy copy returns false', async () => {
    const browser = fakeBrowser({
      writeText: async () => {
        throw new Error('NotAllowedError');
      },
      execCommand: () => false,
    });
    await expect(copyText('http://x/invite/app/1')).resolves.toBe(false);
    expect(browser.execCommand).toHaveBeenCalledWith('copy');
    expect(browser.removeChild).toHaveBeenCalledWith(browser.field);
  });

  it('reports success when the legacy copy really copies after writeText is denied', async () => {
    const browser = fakeBrowser({
      writeText: async () => {
        throw new Error('Document is not focused');
      },
      execCommand: () => true,
    });
    await expect(copyText('http://x/invite/claim/2')).resolves.toBe(true);
    expect(browser.field.value).toBe('http://x/invite/claim/2');
    expect(browser.field.select).toHaveBeenCalled();
  });

  it('falls back to the legacy copy when the async clipboard is unavailable', async () => {
    const browser = fakeBrowser({ execCommand: () => false });
    await expect(copyText('http://x')).resolves.toBe(false);
    expect(browser.execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports failure when the legacy copy throws', async () => {
    fakeBrowser({
      writeText: async () => {
        throw new Error('denied');
      },
      execCommand: () => {
        throw new Error('unsupported');
      },
    });
    await expect(copyText('http://x')).resolves.toBe(false);
  });

  it('never uses expo-clipboard, whose web fallback ignores a false execCommand', async () => {
    fakeBrowser({ writeText: async () => undefined, execCommand: () => false });
    await copyText('http://x');
    expect(setString).not.toHaveBeenCalled();
  });
});

describe('copyText on native', () => {
  it('uses expo-clipboard and reports its result', async () => {
    setString.mockResolvedValue(true);
    await expect(copyText('http://x')).resolves.toBe(true);
    expect(setString).toHaveBeenCalledWith('http://x');
  });

  it('reports failure when expo-clipboard throws', async () => {
    setString.mockRejectedValue(new Error('boom'));
    await expect(copyText('http://x')).resolves.toBe(false);
  });
});
