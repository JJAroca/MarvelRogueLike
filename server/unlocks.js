'use strict';
// ══════════ EXPANSIÓN: condiciones de desbloqueo de personajes ocultos ══════════
// El World llama a estos hooks; el desbloqueo se guarda en el perfil (world.unlock).

const isDarkItem = (it) => !!it.tags && (it.tags.includes('symbiote') || it.tags.includes('dark'));

module.exports = {
  // Venom (a): sobrevivir a una sala con menos del 10% de vida.
  onRoomCleared(w, p) {
    if (!p.downed && p.hp > 0 && p.hp / p.maxHp < 0.10) w.unlock(p, 'venom', 'sobreviviste a una sala con menos del 10% de vida');
  },

  // Venom (b): juntar 3 ítems oscuros/simbionte en la run.
  onItemPicked(w, p, item) {
    if (!isDarkItem(item)) return;
    p.run.darkItems++;
    if (p.run.darkItems >= 3) w.unlock(p, 'venom', 'reuniste 3 ítems oscuros/simbionte');
  },

  // Wolverine: 500+ de daño acumulado recibido en la run sin morir.
  onDamageTaken(w, p) {
    if (p.run.damageTaken >= 500 && p.run.deaths === 0 && !p.downed) w.unlock(p, 'wolverine', 'aguantaste 500 de daño sin caer');
  },

  // Spider-Man 2099: limpiar un piso en < 2 minutos sin recibir daño.
  onFloorCleared(w, p) {
    const t = w.time - p.run.floorStart;
    if (!p.run.floorHit && t < 120) w.unlock(p, 'spider2099', `limpiaste el piso en ${Math.floor(t)} s sin recibir daño`);
  },

  // Bruja Escarlata: el equipo reúne 2+ Gemas del Infinito en la run.
  onGemCollected(w) {
    if (w.gems.size < 2) return;
    for (const p of w.players.values()) w.unlock(p, 'scarlet', 'el equipo reunió 2 Gemas del Infinito');
  },

  // Héroes clásicos (los jefes de los pisos 1–2 son aleatorios, así que cada uno tiene dos caminos):
  // Spider-Man (Magneto o Juggernaut), Capitán América (Carnage, Ultrón o reanimar), Thor (Dormammu).
  onBossDefeated(w, boss) {
    const map = {
      magneto: ['spiderman', 'derrotasteis a Magneto'], juggernaut: ['spiderman', 'derrotasteis a Juggernaut'],
      carnage: ['cap', 'derrotasteis a Carnage'], ultron: ['cap', 'derrotasteis a Ultrón'],
      dormammu: ['thor', 'derrotasteis a Dormammu'],
    };
    const u = map[boss];
    if (!u) return;
    for (const p of w.players.values()) w.unlock(p, u[0], u[1]);
  },

  // Capitán América (alternativa): reanimar a un aliado caído.
  onRevive(w, helper) {
    w.unlock(helper, 'cap', 'reanimaste a un aliado caído');
  },

  // Loki: encontrar la Sala Secreta del Engaño y derrotarle como jefe oculto.
  onSecretBossDefeated(w) {
    for (const p of w.players.values()) w.unlock(p, 'loki', 'derrotaste a Loki en la Sala Secreta del Engaño');
  },
};
