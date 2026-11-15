'use strict';
// Gemas del Infinito: recurso de EQUIPO. Cada gema da un bonus a todos.
// Thanos usa los poderes de las que el equipo NO tenga; con las 6 se abre Galactus.
const GEMS = {
  poder:    { name: 'Gema del Poder',      short: 'Poder',    color: '#a052ff', buff: '+20% de daño para el equipo' },
  espacio:  { name: 'Gema del Espacio',    short: 'Espacio',  color: '#3d7bff', buff: '-40% de enfriamiento del dash' },
  realidad: { name: 'Gema de la Realidad', short: 'Realidad', color: '#ff3b3b', buff: '+10% de probabilidad de crítico' },
  alma:     { name: 'Gema del Alma',       short: 'Alma',     color: '#ff9a1f', buff: '+5% de robo de vida' },
  tiempo:   { name: 'Gema del Tiempo',     short: 'Tiempo',   color: '#2ee86b', buff: '-25% de enfriamiento de habilidades' },
  mente:    { name: 'Gema de la Mente',    short: 'Mente',    color: '#ffd21f', buff: 'Los enemigos van un 15% más lentos' },
};
const GEM_ORDER = ['poder', 'espacio', 'realidad', 'alma', 'tiempo', 'mente'];
// Gemas que custodian las Bóvedas (el resto las sueltan jefes: Magneto→Poder,
// Carnage→Alma, Dormammu→Tiempo, Loki secreto→Mente).
const VAULT_GEMS = ['espacio', 'realidad'];

module.exports = { GEMS, GEM_ORDER, VAULT_GEMS };
