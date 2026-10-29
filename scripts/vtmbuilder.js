/**
 * TokyoStargazer’s VTMBuilder — compatibility shim (from Dark Gifts: Disciplines Restored).
 *
 * The WoD5e system recalculates Health / Willpower on every actor it prepares and writes the result back with
 * actor.update(). For actors that live in a locked compendium (this module's creatures) that write is refused and
 * Foundry shows "You may not update documents in the locked compendium". The recalculated values are identical
 * to what is stored, so for locked-compendium actors we simply skip those automatic writes. Any other edit still
 * goes through (and is refused by Foundry as usual).
 */
const AUTO_KEYS = /^(system\.(health|willpower)\.value|system\.hunger\.value|ownership\.default)$/;

Hooks.once('setup', () => {
  const cls = CONFIG.Actor.documentClass;
  const original = cls.prototype.update;
  cls.prototype.update = function (data = {}, operation = {}) {
    if (this.pack && game.packs.get(this.pack)?.locked) {
      const keys = Object.keys(foundry.utils.flattenObject(data ?? {}));
      if (keys.length && keys.every((k) => AUTO_KEYS.test(k))) return Promise.resolve(this);
    }
    return original.call(this, data, operation);
  };
});
