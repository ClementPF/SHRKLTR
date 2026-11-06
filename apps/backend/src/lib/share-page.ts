import type { ShareSnapshot } from './share-snapshot.js';
import { shareTeams } from './share-renderer.js';
import {
  formatShareDate,
  shareDescription,
  shareTitle,
  signedElo,
  teamTitle,
} from './share-text.js';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for both HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

export interface SharePageInput {
  snapshot: ShareSnapshot;
  /** Absolute canonical URL of this page (from PUBLIC_API_URL, never the request Host). */
  pageUrl: string;
  /** Absolute URL of the PNG card. */
  imageUrl: string;
  /** Where "Open Sharkulator" leads (PUBLIC_WEB_URL/games/<id>). */
  appUrl: string;
}

const STYLE = `
*{box-sizing:border-box}
body{margin:0;background:#111214;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 20px 48px}
.brand{color:#CE2924;font-weight:700;letter-spacing:.3em;font-size:14px;margin:0 0 16px}
h1{font-size:26px;line-height:1.25;margin:0 0 8px;overflow-wrap:anywhere}
.meta{color:#9a9ca3;margin:0 0 24px;overflow-wrap:anywhere}
.teams{display:flex;flex-wrap:wrap;gap:16px;margin:0 0 24px}
section{flex:1 1 240px;background:#1c1d21;border-radius:16px;padding:16px 20px}
h2{font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 8px}
.WIN h2{color:#4cd07d}.LOSS h2{color:#ff6b6b}.TIE h2{color:#9a9ca3}
ul{list-style:none;margin:0;padding:0}
li{display:flex;justify-content:space-between;gap:12px;padding:6px 0}
.name{overflow-wrap:anywhere}
.delta{font-weight:700;white-space:nowrap}
.up{color:#4cd07d}.down{color:#ff6b6b}
img{display:block;width:100%;height:auto;border-radius:16px;margin:0 0 24px}
.cta{display:inline-block;background:#CE2924;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:12px}
`.trim();

/** The public result page; every user-provided string is escaped. */
export function renderSharePage({ snapshot, pageUrl, imageUrl, appUrl }: SharePageInput): string {
  const title = shareTitle(snapshot);
  const description = shareDescription(snapshot);
  const e = escapeHtml;
  const teams = shareTeams(snapshot)
    .map(
      (team) =>
        `<section class="${team.result}"><h2>${e(teamTitle(team.result, team.players.length))}</h2><ul>${team.players
          .map(
            (p) =>
              `<li><span class="name">${e(p.displayName)}</span><span class="delta ${p.eloDelta >= 0 ? 'up' : 'down'}">${e(signedElo(p.eloDelta))} Elo</span></li>`,
          )
          .join('')}</ul></section>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<link rel="canonical" href="${e(pageUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Sharkulator">
<meta property="og:url" content="${e(pageUrl)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:image" content="${e(imageUrl)}">
<meta property="og:image:secure_url" content="${e(imageUrl)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${e(description)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<meta name="twitter:image" content="${e(imageUrl)}">
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="brand">SHARKULATOR</p>
<h1>${e(title)}</h1>
<p class="meta">${e(snapshot.sport)} · ${e(snapshot.tournament)} · ${e(formatShareDate(snapshot.date))}</p>
<div class="teams">${teams}</div>
<img src="${e(imageUrl)}" width="1200" height="630" alt="${e(description)}">
<a class="cta" href="${e(appUrl)}">Open Sharkulator</a>
</main>
</body>
</html>
`;
}

/** Body of the 404 page for unknown or revoked links; reveals nothing about the result. */
export const SHARE_NOT_FOUND_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Result not available · Sharkulator</title>
<style>body{margin:0;background:#111214;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 20px}p{color:#9a9ca3}</style>
</head>
<body>
<main>
<h1>This result is not available</h1>
<p>The link may be wrong, or whoever shared it has turned it off.</p>
</main>
</body>
</html>
`;
