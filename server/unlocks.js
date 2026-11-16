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

  // Jefes (aleatorios, así que cada héroe tiene dos caminos):
  // Spider-Man 2099 (Magneto o Juggernaut), Capitán América (Carnage, Ultrón o reanimar).
  onBossDefeated(w, boss) {
    const map = {
      magneto: ['spider2099', 'derrotasteis a Magneto'], juggernaut: ['spider2099', 'derrotasteis a Juggernaut'],
      carnage: ['cap', 'derrotasteis a Carnage'], ultron: ['cap', 'derrotasteis a Ultrón'],
    };
    const u = map[boss];
    if (!u) return;
    for (const p of w.players.values()) w.unlock(p, u[0], u[1]);
  },

  // Capitán América (alternativa): reanimar a un aliado caído.
  onRevive(w, helper) {
    w.unlock(helper, 'cap', 'reanimaste a un aliado caído');
  },

  // Thor: derrotar a una pareja de jefes dobles.
  onDoubleBoss(w) {
    for (const p of w.players.values()) w.unlock(p, 'thor', 'derrotasteis a dos jefes a la vez');
  },

  // Loki: encontrar la Sala Secreta y superar su desafío.
  onSecretBossDefeated(w) {
    for (const p of w.players.values()) w.unlock(p, 'loki', 'superasteis la Sala Secreta');
  },
};
