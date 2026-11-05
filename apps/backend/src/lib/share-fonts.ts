import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export interface ShareFont {
  name: 'Inter';
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
}

const FONT_FILES = [
  { weight: 400, dir: '400Regular', file: 'Inter_400Regular.ttf' },
  { weight: 700, dir: '700Bold', file: 'Inter_700Bold.ttf' },
] as const;

const require = createRequire(import.meta.url);

// The production image copies the TTFs to dist/assets/fonts (tsc does not copy assets);
// source checkouts read them straight from the @expo-google-fonts/inter dev dependency.
async function fontPath(dir: string, file: string): Promise<string> {
  const bundled = fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
  try {
    await access(bundled);
    return bundled;
  } catch {
    return require.resolve(`@expo-google-fonts/inter/${dir}/${file}`);
  }
}

let loading: Promise<ShareFont[]> | undefined;

/** Bundled static Inter fonts, read from disk once per process. Never fetched remotely. */
export function loadShareFonts(): Promise<ShareFont[]> {
  loading ??= Promise.all(
    FONT_FILES.map(async ({ weight, dir, file }) => ({
      name: 'Inter' as const,
      data: await readFile(await fontPath(dir, file)),
      weight,
      style: 'normal' as const,
    })),
  ).catch((err: unknown) => {
    loading = undefined;
    throw err;
  });
  return loading;
}
