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
`Shift`/`Click der.` habilidad · `Q` ulti · `F` (mantener) reanimar · `G` soltar ítem · `M` silenciar.
El personaje mira siempre hacia el cursor (puedes caminar hacia atrás mientras disparas).

**Reanimación:** un aliado debe mantener `F` **10 s** junto al jugador caído. Si en **20 s** nadie
le reanima, pasa a **Forma Astral** (25% de daño, intangible, más lento) hasta que se limpie la sala.
La run se pierde si no queda ningún jugador activo.

## Publicarlo en internet gratis (Render)

El repositorio trae `render.yaml`. Render publica el juego gratis desde GitHub y lo vuelve a
publicar solo en cada `git push` a `main`.

1. Entra en https://render.com con tu cuenta de GitHub.
2. **New + → Blueprint** → elige el repositorio `MarvelRogueLike` → **Apply**.
3. En unos minutos queda en `https://marvel-roguelike.onrender.com` (o el nombre que asigne Render).

Limitaciones del plan gratuito:
- Se duerme tras ~15 min sin jugadores; el primero que entre espera ~30 s a que despierte.
- No hay disco persistente: los perfiles (Iso-8, desbloqueos) vuelven a los de `data/profiles.json`
  cada vez que el servicio se reinicia, se duerme o se actualiza.

Variables: `PORT` (puerto) y `DATA_DIR` (carpeta de perfiles; por defecto `data/`).
También hay un `Dockerfile` por si algún día se quiere usar un hosting con Docker y disco persistente.

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

Solo hay jefes con sprite real: **Juggernaut, Ultrón, Magneto y Carnage** (Thanos, Dormammu, Loki y
Galactus quedan fuera de la rotación). Se sortean al empezar la run y el primer jefe de cada piso fija
su **bioma** (fondo, colores y enemigos); las salas no cambian de fondo al avanzar.

| Jefe sorteado | Bioma (fondo) | Enemigos habituales |
|---|---|---|
| Juggernaut | Laboratorio A.I.M. destruido (`AIMStage`) | Matones, ladrones, robots kamikaze, A.I.M. |
| Ultrón | Fortaleza Cibernética (`FuturistStage`) | Enjambres de Mini-Ultron, ninjas cibernéticos, kamikazes |
| Magneto | Santuario de Genosha (`MagicStage`) | Acólitos, matones, A.I.M. láser, ninjas |
| Carnage | Base Ravencroft (`MagicStage`, tono rojo) | Simbiontes, ladrones, matones, ninjas |

| Piso | Jefes | Extra |
|---|---|---|
| 1 | 1 jefe | — |
| 2 | 1 jefe | Sala de **emboscada** (oleadas que aparecen alrededor del equipo) |
| 3 | **2 jefes a la vez** | Emboscada · los jefes dobles sueltan una gema |
| 4 (final) | **2 jefes a la vez** | Emboscada · al vencerlos, victoria (verdadera si tenéis las 6 gemas) |

Vida de los jefes según jugadores: 1P 100% · 2P 155% · 3P 200% · 4P 240% (cada jefe de una pareja, 75%).

**Portales bidireccionales:** en una sala despejada hay portales (`VoidPortal`) hacia todas las salas
conectadas en el minimapa, también hacia atrás. Las salas despejadas conservan lo que quedó en el suelo.

**Gemas del Infinito** (difíciles): desafíos cronometrados (45 s), jefes dobles, la Sala Secreta y, con
un 35%, las Bóvedas. Cada gema da un bonus al equipo pero también **Sobrecarga Cósmica**: al entrar en
combate, 15% por gema de que una se desestabilice 10 s (Espacio: teletransportes · Poder: todos +50% de
daño · Tiempo: héroes −30% de velocidad · Realidad: ilusiones y proyectiles que rebotan · Alma: −2% vida/s
hasta conseguir una baja · Mente: minimapa bloqueado e interferencias). Con las **6** se activa el
**Poder del Guantelete** (+50% daño, +15% velocidad, −25% enfriamientos) y cesan las maldiciones.

**Goblin Saqueador:** si te toca, roba un ítem del inventario (lo verás flotando sobre su saco) y huye;
a los 12 s escapa por un portal a una sala vecina (marcada con `$` en el minimapa) donde podéis
perseguirlo. Abatido, suelta el ítem y cristales Iso-8. **Robots Kamikaze:** se arman 0,9 s (retícula
roja) y su explosión quita 45–65% de la vida máxima, también a enemigos y jefes cercanos.

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
| Capitán América | Reanimar a un aliado, o derrotar a Carnage o a Ultrón |
| Thor | Derrotar a una pareja de jefes dobles |
| Venom | Sobrevivir a una sala con <10% de vida, o reunir 3 ítems oscuros/simbionte |
| Wolverine | Recibir 500+ de daño acumulado en una run sin ser derribado |
| Spider-Man 2099 | Derrotar a Magneto o a Juggernaut, o limpiar un piso en menos de 2 minutos sin recibir daño. Sustituye a Spider-Man clásico (efectos 8-bit) |
| Bruja Escarlata | Reunir 2+ Gemas del Infinito en una run |
| Loki | Encontrar la Sala Secreta y superar su desafío |

## Progresión permanente

Al terminar cada run (victoria o derrota) se ganan fragmentos **Iso-8**, que se gastan en la
tienda del lobby: Vida máxima, Daño base, Velocidad de movimiento y Probabilidad de ítems raros.
Los perfiles se guardan en `data/profiles.json` (identificados por nombre de héroe).

## Inventario, sinergias y audio

- **Inventario de 6 ranuras** (hotbar inferior). Con el inventario lleno no recoges más: suelta uno con
  `G` (el seleccionado con clic, o el último recogido), `Shift`+clic o clic central en la ranura. El ítem
  queda en el suelo para tus amigos (quien lo suelta no puede recogerlo durante 1,2 s). Pasa el cursor
  por una ranura o por un ítem del suelo para ver su tooltip con estadísticas.
- **Sinergias cooperativas** (bonus para todo el equipo, ver `server/game/synergies.js`):
  Vengadores (Iron Man + Hulk: +10% daño y escudo inicial), Sobrenatural (Doctor Strange + Ghost Rider:
  +15% daño de habilidad y quemadura), Spider-Verso, Escudo y Martillo, X-Force y Caos y Engaño.
- **Audio** (`client/js/audioManager.js`): efectos de `public/audio/sfx/`, voces de `public/audio/voices/<héroe>/`
  (Iron Man y Hulk) y música. Pon tus canciones en `public/audio/music/`: rotan automáticamente por bioma
  (si el nombre contiene `aim`, `futurist`, `magic`, `cosmic` o `menu` se usan para ese bioma) y las que
  contienen `boss`, `jefe` o `epic` suenan en los jefes. Sin canciones se genera música chiptune.
  Menú **⚙ Configuración** (pantalla inicial, lobby y HUD): volumen de Música, Efectos y Voces, silencio
  y "Cambiar pista".
- Si un amigo se desconecta, la sala sigue: sus ítems caen al suelo y sus proyectiles/zonas desaparecen.

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
    floors.js          Pisos, jefes dobles, emboscadas, ramas y conexiones
    curses.js          Sobrecarga Cósmica (maldiciones de las gemas)
    synergies.js       Sinergias cooperativas
    items.js           Ítems pasivos y rarezas
    gems.js            Gemas del Infinito
client/
  index.html, style.css
  js/main.js           Red, input, interpolación
  js/sprites.js        Hojas, iconos, efectos, fondos y HUD; volteo según el cursor
  js/audioManager.js   AudioManager: música por bioma/jefe, efectos, voces y silencio
  js/uiRenderer.js     HUD: retrato, vida, hotbars, inventario (6), tooltips, minimapa, transiciones
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
