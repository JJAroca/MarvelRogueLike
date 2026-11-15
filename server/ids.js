'use strict';
// Contador global de IDs: jugadores, enemigos, proyectiles, etc. comparten espacio
// para que el cliente pueda interpolar por id sin colisiones.
let n = 1;
module.exports = () => n++;
