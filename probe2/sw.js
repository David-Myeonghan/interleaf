// Holds the directory handle the popup picked, and answers the content script.
let held = null;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'hold') { held = msg.handle; reply({ ok: !!held, name: held?.name ?? null }); return false; }
  if (msg?.type === 'take') { reply({ handle: held, name: held?.name ?? null }); return false; }
  return false;
});
