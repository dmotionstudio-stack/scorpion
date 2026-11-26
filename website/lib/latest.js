// The newest Scorpion release, for the free downloads on the Download page. The release is read from GitHub (the repo is public;
// the answer is cached by Cloudflare for ten minutes), and the installers are served from our own Cloudflare bucket when
// they are there, from the GitHub release when they are not. The OS image and the model pack are not free: they stay in the
// paid editions (api/download.js).

import { PLATFORMS } from '../data/catalog.js';

export const DEFAULT_REPO = 'dmotionstudio-stack/scorpion';

// The installers anyone may download. `match` finds each in the release's files.
export const FREE_FILES = [
  { key: 'win', match: /^Scorpion-Setup-[\d.]+\.exe$/ },
  { key: 'mac-arm', match: /^Scorpion-[\d.]+-arm64\.dmg$/ },
  { key: 'mac-intel', match: /^Scorpion-[\d.]+\.dmg$/ },
];

export async function latestRelease(env = {}) {
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'scorpion-website' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers, cf: { cacheTtl: 600, cacheEverything: true } });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const data = await res.json();
  return {
    version: String(data.tag_name || '').replace(/^v/, ''),
    published: data.published_at || null,
    page: data.html_url || `https://github.com/${repo}/releases`,
    assets: (data.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })),
  };
}

// The free files of a release: { key, label, short, name, size, url }.
export function freeFiles(release) {
  const files = [];
  for (const { key, match } of FREE_FILES) {
    const asset = release.assets.find((a) => match.test(a.name));
    if (!asset) continue;
    const p = PLATFORMS[key];
    files.push({ key, label: p.label, short: p.short, name: asset.name, size: asset.size, url: asset.url });
  }
  return files;
}
