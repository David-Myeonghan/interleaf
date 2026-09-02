import * as cdp from './cdp.mjs';
const KNOWN = new Set(['nkeimhogjdpnpccoofpliimaahmaaome','fignfifoniblkonapihmkfakmlgkbkcf','mhjfbmdgcfjbbpaeojofohoefgiehjai','ghbmnnjooekpmoecnnnilnnbdlolhkhi','nmmhkkegccagdldgiimedpiccmgmieda']);
const ts = await cdp.targets();
const ids = new Set();
for (const t of ts) {
  const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(t.url);
  if (m && !KNOWN.has(m[1])) ids.add(m[1]);
}
console.log(JSON.stringify({ found: [...ids], allTargets: ts.map(t => ({ type: t.type, url: t.url.slice(0, 80) })) }, null, 2));
