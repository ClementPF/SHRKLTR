import satori from 'satori';
import { renderAsync } from '@resvg/resvg-js';
import { loadShareFonts } from './share-fonts.js';
import type { ShareParticipant, ShareSnapshot } from './share-snapshot.js';
import { formatShareDate, signedElo, teamTitle } from './share-text.js';

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;
/** Bump when the card layout changes so cached PNGs of the old layout are not reused. */
export const SHARE_CARD_TEMPLATE_VERSION = 1;

/** Rows a team panel shows before collapsing the rest into "+N players". */
const MAX_ROWS = 4;
const MAX_NAME_CHARS = 32;

const COLORS = {
  background: '#111214',
  panel: '#1c1d21',
  accent: '#CE2924',
  text: '#ffffff',
  muted: '#9a9ca3',
  win: '#4cd07d',
  loss: '#ff6b6b',
};

type CardNode = Parameters<typeof satori>[0];
type Style = Record<string, string | number>;

function el(style: Style, children: CardNode | CardNode[] | string = []): CardNode {
  return { type: 'div', key: null, props: { style: { display: 'flex', ...style }, children } };
}

function shorten(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`;
}

const singleLine: Style = {
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};

function playerRow(player: ShareParticipant, fontSize: number): CardNode {
  return el({ flexDirection: 'row', alignItems: 'center', width: '100%', gap: 24 }, [
    el(
      { flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize, color: COLORS.text, ...singleLine },
      shorten(player.displayName, MAX_NAME_CHARS),
    ),
    el(
      {
        flexShrink: 0,
        fontSize,
        fontWeight: 700,
        color: player.eloDelta >= 0 ? COLORS.win : COLORS.loss,
      },
      signedElo(player.eloDelta),
    ),
  ]);
}

/** Small teams get room for a two-line name with the Elo change underneath. */
function featuredPlayer(player: ShareParticipant): CardNode {
  return el({ flexDirection: 'column', width: '100%', gap: 4 }, [
    {
      type: 'div',
      key: null,
      props: {
        style: {
          display: 'block',
          fontSize: 46,
          lineHeight: 1.15,
          color: COLORS.text,
          lineClamp: 2,
        },
        children: shorten(player.displayName, MAX_NAME_CHARS),
      },
    },
    el(
      { fontSize: 40, fontWeight: 700, color: player.eloDelta >= 0 ? COLORS.win : COLORS.loss },
      `${signedElo(player.eloDelta)} Elo`,
    ),
  ]);
}

function teamPanel(result: ShareParticipant['result'], players: ShareParticipant[]): CardNode {
  const featured = players.length === 1;
  const shown = players.length > MAX_ROWS ? players.slice(0, MAX_ROWS - 1) : players;
  const hidden = players.length - shown.length;
  const fontSize = players.length <= 2 ? 40 : 34;
  const titleColor = result === 'WIN' ? COLORS.win : result === 'LOSS' ? COLORS.loss : COLORS.muted;
  return el(
    {
      flexDirection: 'column',
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      boxSizing: 'border-box',
      padding: 28,
      gap: featured ? 20 : 14,
      borderRadius: 24,
      backgroundColor: COLORS.panel,
    },
    [
      el(
        { fontSize: 24, fontWeight: 700, letterSpacing: 4, color: titleColor },
        teamTitle(result, players.length).toUpperCase(),
      ),
      ...shown.map((p) => (featured ? featuredPlayer(p) : playerRow(p, fontSize))),
      ...(hidden > 0 ? [el({ fontSize: 30, color: COLORS.muted }, `+${hidden} players`)] : []),
    ],
  );
}

/** Participants grouped by result, winners first. */
export function shareTeams(
  snapshot: ShareSnapshot,
): { result: ShareParticipant['result']; players: ShareParticipant[] }[] {
  return (['WIN', 'TIE', 'LOSS'] as const)
    .map((result) => ({
      result,
      players: snapshot.participants.filter((p) => p.result === result),
    }))
    .filter((team) => team.players.length > 0);
}

/** The card as a satori element tree; exported for layout tests. */
export function shareCardTree(snapshot: ShareSnapshot): CardNode {
  return el(
    {
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: SHARE_CARD_WIDTH,
      height: SHARE_CARD_HEIGHT,
      boxSizing: 'border-box',
      padding: 56,
      gap: 24,
      backgroundColor: COLORS.background,
      color: COLORS.text,
      fontFamily: 'Inter',
      fontWeight: 400,
    },
    [
      el({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 32 }, [
        el(
          { fontSize: 30, fontWeight: 700, letterSpacing: 6, color: COLORS.accent, flexShrink: 0 },
          'SHARKULATOR',
        ),
        el(
          {
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 2,
            color: COLORS.muted,
            minWidth: 0,
            ...singleLine,
          },
          shorten(snapshot.sport.toUpperCase(), 40),
        ),
      ]),
      el({ fontSize: 30, color: COLORS.text, ...singleLine }, shorten(snapshot.tournament, 60)),
      el(
        { flexDirection: 'row', flexGrow: 1, gap: 32, minHeight: 0 },
        shareTeams(snapshot).map((team) => teamPanel(team.result, team.players)),
      ),
      el(
        {
          flexDirection: 'row',
          justifyContent: 'space-between',
          fontSize: 24,
          color: COLORS.muted,
        },
        [el({}, formatShareDate(snapshot.date)), el({}, 'Elo changes from this game')],
      ),
    ],
  );
}

/** Renders the 1200×630 PNG with the bundled Inter fonts only (no remote fonts or images). */
export async function renderShareCard(snapshot: ShareSnapshot): Promise<Buffer> {
  const svg = await satori(shareCardTree(snapshot), {
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    fonts: await loadShareFonts(),
  });
  // renderAsync rasterizes on the libuv thread pool instead of blocking the event loop.
  const image = await renderAsync(svg, { fitTo: { mode: 'original' } });
  return image.asPng();
}
