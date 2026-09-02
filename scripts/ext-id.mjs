// Resolving the extension's id. The profile's registry is authoritative but is
// written lazily, so a live service-worker target is used when it is absent.
import * as cdp from './cdp.mjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXT_DIR = fileURLToPath(new URL('../extension', import.meta.url));
const PREFS = fileURLToPath(new URL('../.dev-profile/Default/Secure Preferences', import.meta.url));

// Chrome for Testing ships these; they are not ours.
const BUNDLED = new Set([
  'nkeimhogjdpnpccoofpliimaahmaaome',
  'glbjnfimcajjenihimblfaponejbkoph',
  'mhjfbmdgcfjbbpaeojofohoefgiehjai',
  'ghbmnnjooekpmoecnnnilnnbdlolhkhi',
  'nmmhkkegccagdldgiimedpiccmgmieda',
]);

export async function extensionId() {
  if (fs.existsSync(PREFS)) {
    const settings = JSON.parse(fs.readFileSync(PREFS, 'utf8')).extensions?.settings ?? {};
    const found = Object.entries(settings).find(([, v]) => v.path === EXT_DIR)?.[0];
    if (found) return found;
  }
  const fromTarget = (await cdp.targets())
    .map((t) => /^chrome-extension:\/\/([a-p]{32})\//.exec(t.url)?.[1])
    .find((id) => id && !BUNDLED.has(id));
  if (fromTarget) return fromTarget;
  throw new Error('extension id not found; is dev-chrome.sh running with ' + EXT_DIR + '?');
}
