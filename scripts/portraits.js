/**
 * TokyoStargazer’s VTMBuilder — portraits from VTM Builder.
 *
 * VTM Builder keeps the character's portrait inside the exported actor (flags["vtm-builder"].character.portrait,
 * a small WebP/JPEG data URL), because Foundry only accepts image files as actor art. When such an actor is
 * imported or created, this script uploads the portrait to worlds/<world>/vtmb-portraits/ and sets it as the
 * actor's image and its token image. It runs for whoever imports (if they may upload files); otherwise the GM's
 * client picks it up when the world loads.
 *
 * It also lets Import Data take a builder file of another actor type (a mortal or ghoul file on a Vampire actor):
 * the actor's type is switched to match the file before the import.
 */
const MOD = 'tokyostargazer-vtmbuilder';
const DIR = () => `worlds/${game.world.id}/vtmb-portraits`;
const keyOf = (data) => data.length + ':' + data.slice(-32);
const busy = new Set();

function portraitOf(actor) {
  const data = actor?.flags?.['vtm-builder']?.character?.portrait;
  return typeof data === 'string' && data.startsWith('data:image/') ? data : null;
}

function needsPortrait(actor) {
  if (!actor || actor.pack || !actor.isOwner) return false;
  const data = portraitOf(actor);
  return !!data && actor.flags?.[MOD]?.portraitKey !== keyOf(data);
}

async function applyPortrait(actor) {
  if (!needsPortrait(actor) || busy.has(actor.id)) return;
  if (!game.user.can('FILES_UPLOAD')) return; // a GM's client will do it
  busy.add(actor.id);
  try {
    const data = portraitOf(actor);
    const mime = data.slice(5, data.indexOf(';'));
    const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[mime] || 'webp';
    const blob = await (await fetch(data)).blob();
    const slug = String(actor.name || 'kindred').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kindred';
    const tag = Date.now().toString(36); // a new name per upload, so a changed portrait shows at once
    const file = new File([blob], `${slug}-${actor.id}-${tag}.${ext}`, { type: mime });
    const FP = foundry.applications.apps.FilePicker.implementation;
    try { await FP.createDirectory('data', DIR(), {}); } catch (e) { /* already there */ }
    const res = await FP.upload('data', DIR(), file, {}, { notify: false });
    if (!res?.path) throw new Error('upload refused');
    const path = res.path;
    await actor.update({ img: path, 'prototypeToken.texture.src': path, [`flags.${MOD}.portraitKey`]: keyOf(data) });
  } catch (err) {
    console.error(`${MOD} | portrait upload failed for ${actor.name}`, err);
    ui.notifications.warn(`Couldn’t save ${actor.name}’s portrait from VTM Builder: ${err.message}`);
  } finally {
    busy.delete(actor.id);
  }
}

Hooks.once('setup', () => {
  // Foundry's Import Data skips document hooks, so follow the import itself
  const cls = CONFIG.Actor.documentClass;
  const original = cls.prototype.importFromJSON;
  cls.prototype.importFromJSON = async function (json, ...rest) {
    // VTM Builder files say which kind of actor they are (vampire, mortal, ghoul). Foundry's Import Data can't change
    // an actor's type, so if the file was dropped onto an actor of another type, switch the type first.
    let data = null;
    try { data = JSON.parse(json); } catch (e) { /* not JSON: let Foundry report it */ }
    const type = data && data.flags && data.flags['vtm-builder'] && data.type;
    if (type && type !== this.type && game.documentTypes?.Actor?.includes(type)) {
      try {
        const FR = foundry.data.operators.ForcedReplacement;
        await this.update({ type, system: new FR(data.system || {}) }, { diff: false, recursive: false });
        ui.notifications.info(`${this.name}: switched to a ${game.i18n.localize(CONFIG.Actor.typeLabels?.[type] || type)} actor for this VTM Builder file.`);
      } catch (err) {
        console.error(`${MOD} | could not switch ${this.name} to ${type}`, err);
        ui.notifications.error(`This file is a ${type} character. Create an actor of that type and import it there.`, { permanent: true });
        return this;
      }
    }
    const out = await original.call(this, json, ...rest);
    applyPortrait(this);
    return out;
  };
});

Hooks.on('createActor', (actor, options, userId) => { if (userId === game.user.id) applyPortrait(actor); });
Hooks.on('updateActor', (actor, change, options, userId) => {
  if (userId === game.user.id && change?.flags?.['vtm-builder']) applyPortrait(actor);
});

// anything imported by a player who can't upload files: the GM's client catches up on load
Hooks.once('ready', () => {
  if (!game.user.isGM) return;
  for (const actor of game.actors) if (needsPortrait(actor)) applyPortrait(actor);
});
