// GET /api/latest  ->  { version, published, page, files: [{ key, label, short, name, size, href }] }
// The newest release and its free installers, for the Download page. href is our own address (/dl/<key>), which sends the
// visitor to the file.

import { freeFiles, latestRelease } from '../lib/latest.js';
import { json } from '../lib/stripe.js';

export async function GET(_request, env) {
  try {
    const release = await latestRelease(env);
    const files = freeFiles(release).map(({ url, ...f }) => ({ ...f, href: `/dl/${f.key}` }));
    const response = json({ version: release.version, published: release.published, page: release.page, files });
    response.headers.set('Cache-Control', 'public, max-age=300');
    return response;
  } catch (err) {
    return json({ error: 'The latest release could not be read.' }, 502);
  }
}
