# Marvel RogueLike (fan game cooperativo)

Roguelike de acción cooperativo para 1–4 jugadores en el navegador.
Servidor **autoritativo** en Node.js (sin dependencias) + cliente HTML5 Canvas.

## Cómo jugar

```bash
npm start
```

Abre `http://localhost:3000`. Para jugar con amigos en tu red local, comparte la URL
`http://TU-IP:3000` que aparece en la consola y usad el **mismo código de sala**.

**Controles:** `WASD` moverse · `Click` atacar (mantener) · `Espacio` dash ·
`Shift`/`Click der.` habilidad · `Q` ulti · `F` (mantener) reanimar · `M` silenciar.
El personaje mira siempre hacia el cursor (puedes caminar hacia atrás mientras disparas).

**Reanimación:** un aliado debe mantener `F` **10 s** junto al jugador caído. Si en **20 s** nadie
le reanima, pasa a **Forma Astral** (25% de daño, intangible, más lento) hasta que se limpie la sala.
La run se pierde si no queda ningún jugador activo.

## Sprites

```bash
pip install pillow numpy        # scipy es opcional (acelera el procesado)
python scripts/process_sprites.py          # genera public/sprites_processed/
python scripts/process_sprites.py --debug  # + hojas numeradas en public/sprites_processed/_debug/
```

Lee los originales de `sprites/` y sus subcarpetas (`herosprite/`, `boss/`, `enemies/`, `items/`,
`output_effects/`, `stage/`, `chest/`, `menu/`) sin modificarlos nunca, y genera en
`public/sprites_processed/`:

- **Hojas de personajes**: quita el fondo (cuadriculado, blanco o paneles grises con rótulos como en
  Ultron/Ladrones), detecta cada sprite y lo alinea por los pies en celdas de 64×64 (96×96 para jefes
  y Hulk/Hulk-Buster). Qué frames forman cada animación se define en `scripts/sprite_layout.json`
  (`walk_*`, `attack_*` y animaciones especiales como `charge`, `stunned`, `summon`). `_facing: "right"`
  indica que el dibujo lateral mira a la derecha: el juego lo voltea según el cursor.
  Si falta un original (p. ej. `Carnage.png`), se conserva la hoja ya procesada.
- `items/` (iconos 64×64), `fx/` (efectos sin fondo), `stage/` (teselas de bioma), `chests.png`
  (6 cofres) y `ui/` (marcos de vida/escudo, ranuras, cristal Iso-8).
- `manifest.json` describe todo lo anterior.

Los personajes/jefes sin hoja se dibujan con figuras geométricas.

## Estructura de una run

Los jefes de los **pisos 1 y 2 se sortean** al empezar la run entre **Juggernaut, Ultrón, Magneto y
Carnage** (sin repetir). El jefe sorteado fija el **bioma de todo el piso** (fondo, colores y enemigos);
las salas no cambian de fondo al avanzar.

| Jefe sorteado | Bioma (fondo) | Enemigos habituales |
|---|---|---|
| Juggernaut | Laboratorio A.I.M. destruido (`AIMStage`) | Matones, ladrones, robots kamikaze, A.I.M. |
| Ultrón | Fortaleza Cibernética (`FuturistStage`) | Enjambres de Mini-Ultron, ninjas cibernéticos, kamikazes |
| Magneto | Santuario de Genosha (`MagicStage`) | Acólitos, matones, A.I.M. láser, ninjas |
| Carnage | Base Ravencroft (`MagicStage`, tono rojo) | Simbiontes, ladrones, matones, ninjas |

| Piso | Jefe | Gema que suelta |
|---|---|---|
| 1 | Sorteado | Poder |
| 2 | Sorteado | Alma |
| 3 · Dimensión Oscura | Dormammu | Tiempo |
| 4 · El Santuario | Thanos | — (usa las gemas que os falten) |
| Secreto (piso 1–3 al azar) | Loki | Mente |
| 5 · Borde del Universo | **Galactus** (solo con las 6 gemas) | — |

- **Juggernaut**: embestida imparable en línea recta; si choca contra la pared queda **aturdido 2,5 s**
  (recibe +50% de daño). Lanza rocas que **aturden 1,5 s** y golpea el suelo a corta distancia.
- **Ultrón**: ráfagas de rayos repulsores, barrido de rayo sostenido (avisado) e invocación de drones Mini-Ultron.

Cada piso tiene 3 salas por oleadas y una arena de jefe grande con refuerzos. Tras algunas
salas aparecen ramas: **Sala del Tesoro** y **Bóveda** (oleadas élite que custodian las gemas
Espacio/Realidad). La **Sala Secreta del Engaño** está oculta en una sala de algún piso:
busca destellos verdes cerca de la pared inferior.

## Personajes

Base:

| Personaje | Mecánica especial |
|---|---|
| Iron Man | Con 3+ ítems de armadura evoluciona a **Hulk-Buster** |
| Ghost Rider | Cada 15 bajas, **Moto Infernal** 8 s dejando fuego. Con *Fuego Azul de Zadkiel* pasa a llamas azules |
| Hulk | En su 1ª caída se convierte en **Banner** 2 min; si sobrevive, vuelve Hulk |
| Doctor Strange | Curación en área; con 2+ ítems místicos, también inmunidad |

Desbloqueables (se guardan para siempre en tu perfil):

| Personaje | Cómo desbloquearlo |
|---|---|
| Spider-Man | Derrotar a Magneto o a Juggernaut |
| Capitán América | Reanimar a un aliado, o derrotar a Carnage o a Ultrón |
| Thor | Derrotar a Dormammu |
| Venom | Sobrevivir a una sala con <10% de vida, o reunir 3 ítems oscuros/simbionte |
| Wolverine | Recibir 500+ de daño acumulado en una run sin ser derribado |
| Spider-Man 2099 | Limpiar un piso en menos de 2 minutos sin recibir daño (efectos de sonido 8-bit en dash y habilidades) |
| Bruja Escarlata | Reunir 2+ Gemas del Infinito en una run |
| Loki | Encontrar la Sala Secreta del Engaño y derrotar a Loki |

## Progresión permanente

Al terminar cada run (victoria o derrota) se ganan fragmentos **Iso-8**, que se gastan en la
tienda del lobby: Vida máxima, Daño base, Velocidad de movimiento y Probabilidad de ítems raros.
Los perfiles se guardan en `data/profiles.json` (identificados por nombre de héroe).

## Ítems

Cada PNG de `sprites/items/` es un ítem: **el nombre del archivo es su id** (`JetBoots.png` → `JetBoots`).
Sus estadísticas están en `server/game/items.js`; si añades un PNG nuevo sin entrada, el servidor
deduce el efecto por palabras clave del nombre (Boots → velocidad, Sword/Claw → cuerpo a cuerpo, etc.).
Ejemplos: `JetBoots` +velocidad/−enfriamiento del dash · `SuperSoldierSerum` +vida y curación ·
`ArcReactorShield` escudo recargable · `AdamantiumClawRight` +daño cuerpo a cuerpo · `Iso8Crystal`
+daño de habilidad/crítico · `GammaGrenade` granada en área cada 5 s · `SpyDrone` dron que dispara ·
`BlueSoulSkull` Fuego Azul de Zadkiel (Ghost Rider). Al recogerlos aparece su icono en las ranuras
del HUD, un aviso con el efecto y un aura sutil en el héroe.

## Arquitectura

```
server/
  server.js            HTTP estático + WebSocket + salas
  ws.js                WebSocket mínimo (RFC 6455) sin dependencias
  ids.js               IDs globales de entidades
  profiles.js          Persistencia de perfiles (Iso-8, mejoras, desbloqueos)
  shop.js              Tienda de mejoras permanentes            ← expansión
  unlocks.js           Condiciones de desbloqueo                ← expansión
  game/
    room.js            Lobby, inicio/fin de run, bucle 60 Hz, snapshots 30 Hz
    world.js           Simulación: jugadores, combate, salas, puertas, botín
    characters.js      Personajes base (Iron Man, Ghost Rider, Hulk, Doctor Strange)
    characters_hidden.js  Spider-Man, Cap, Thor + Venom, Wolverine, 2099, Bruja Escarlata, Loki ← expansión
    bosses.js          Magneto, Carnage, Loki, Dormammu, Thanos, Galactus ← expansión
    enemies.js         Enemigos normales e IA
    floors.js          Generación de pisos y ramas
    items.js           Ítems pasivos y rarezas
    gems.js            Gemas del Infinito
client/
  index.html, style.css
  js/main.js           Red, input, interpolación
  js/sprites.js        Hojas, iconos, efectos, fondos y HUD; volteo según el cursor
  js/audio.js          Sonidos (public/audio/) + sintetizador 8-bit de Spider-Man 2099
  js/render.js         Dibujo del mundo y HUD
scripts/
  process_sprites.py   Procesador/recortador de hojas de sprites
  sprite_layout.json   Qué frames forman cada animación
sprites/               Hojas originales (no se modifican)
public/sprites_processed/  Hojas limpias + manifest.json
  js/ui.js             Lobby, tienda, fin de run, avisos
```

**Sincronización:** el cliente solo envía su input (teclas, punto de mira, pulsaciones);
toda la lógica (daño, estados, IA, desbloqueos, recompensas) ocurre en el servidor,
que envía el estado completo 30 veces por segundo. El cliente interpola entre snapshots.

Proyecto de fans sin ánimo de lucro; los personajes pertenecen a sus propietarios.
