// Carga las hojas de /sprites_processed/ (generadas por scripts/process_sprites.py)
// y dibuja frames anclados por los pies. Si falta una hoja, has() devuelve false
// y el renderer usa el dibujo geométrico de respaldo.
//
// Orientación: los dibujos laterales miran a la DERECHA (manifest: facing). El sprite se
// voltea con ctx.scale(-1, 1) según el ángulo de APUNTADO (cursor), no según hacia dónde
// se camina: así se puede andar hacia atrás disparando.
// También carga iconos de ítems, efectos, fondos de bioma, cofres y piezas del HUD.

// Personaje (y forma) → hoja de sprites.
export function heroSpriteKey(charId, form) {
  switch (charId) {
    case 'ironman': return form === 'hulkbuster' ? 'hulkbuster' : 'ironman';
    case 'ghostrider': return form === 'blue' ? 'ghost-rider-blue' : 'ghost-rider-normal';
    case 'hulk': return form === 'banner' ? 'banner' : 'hulk';
    case 'strange': return 'doctor-strange';
    case 'spider2099': return 'spider2099';
    default: return null;
  }
}

// Tipo de enemigo/jefe → hoja de sprites.
export const ENEMY_SPRITES = {
  magneto: 'magneto',
  carnage: 'carnage',
  juggernaut: 'juggernaut',
  ultron: 'ultron',
  shooter: 'soldado-aim',
  goblin: 'goblin',
  aimlaser: 'aim-laser',
  miniultron: 'mini-ultron',
  grunt: 'thug',
  thief: 'thief',
  kamikaze: 'kamikaze',
  symbiote: 'simbionte',
  ninja: 'ninja',
};

export function dirOf(a) {
  const q = Math.PI / 4;
  if (a > -q && a <= q) return 'right';
  if (a > q && a <= 3 * q) return 'down';
  if (a > -3 * q && a <= -q) return 'up';
  return 'left';
}

export class Sprites {
  constructor(base = '/sprites_processed/') {
    this.base = base;
    this.m = null;
    this.img = {};
    this.items = {};    // id de ítem (= nombre del PNG) → Image
    this.fx = {};       // nombre del efecto → Image
    this.stages = {};   // bioma → Image
    this.ui = {};       // pieza del HUD → Image
    this.chests = null;
    this.gems = {};     // Gema del Infinito → Image (sprites/items/Gemas.jpg)
    this.onload = null;
    fetch(base + 'manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m || !m.sprites) return;
        this.m = m;
        let pending = Object.keys(m.sprites).length;
        const done = () => { if (--pending === 0 && this.onload) this.onload(); };
        for (const [k, v] of Object.entries(m.sprites)) {
          const im = new Image();
          im.onload = () => { this.img[k] = im; done(); };
          im.onerror = done;
          im.src = base + v.file;
        }
        const load = (store, key, file) => { const im = new Image(); im.onload = () => { store[key] = im; }; im.src = base + file; };
        for (const id of m.items || []) load(this.items, id, `items/${id}.png`);
        for (const [k, v] of Object.entries(m.fx || {})) load(this.fx, k, v.file);
        for (const [k, v] of Object.entries(m.stages || {})) load(this.stages, k, v.file);
        for (const [k, v] of Object.entries(m.ui || {})) load(this.ui, k, v.file);
        for (const [k, v] of Object.entries(m.gems || {})) load(this.gems, k, v);
        if (m.chests) { const im = new Image(); im.onload = () => { this.chests = im; }; im.src = base + m.chests.file; }
      })
      .catch(() => { /* sin sprites: se usa el respaldo geométrico */ });
  }

  has(k) { return !!(k && this.img[k] && this.m.sprites[k]); }
  entry(k) { return this.m.sprites[k]; }

  // Elige animación y volteo para el ángulo de apuntado.
  //   1) pista explícita del servidor (p. ej. 'charge', 'stunned', 'summon')
  //   2) arriba/abajo si la hoja tiene esa vista (kind_up / kind_down)
  //   3) vista lateral: kind_left/kind_right; si solo existe un lado, se voltea el otro
  //   4) animación genérica (kind) volteada según 'facing'
  pick(k, kind, angle, hint) {
    const e = this.m.sprites[k];
    const a = e.anims;
    const facing = e.facing || null;
    const dir = dirOf(angle);
    const side = Math.cos(angle) < 0 ? 'left' : 'right';
    const other = side === 'left' ? 'right' : 'left';
    const flipFor = () => !!facing && side !== facing;
    if (hint && a[hint]) return { anim: a[hint], flip: flipFor() };
    const kinds = kind === 'attack' ? ['attack', 'walk'] : ['walk'];
    for (const kd of kinds) {
      if ((dir === 'up' || dir === 'down') && a[`${kd}_${dir}`]) return { anim: a[`${kd}_${dir}`], flip: false };
      if (a[`${kd}_${side}`]) return { anim: a[`${kd}_${side}`], flip: false };
      if (a[`${kd}_${other}`]) return { anim: a[`${kd}_${other}`], flip: true };
      if (a[kd]) return { anim: a[kd], flip: flipFor() };
      if (kd === 'attack' && (a.attack_down || a.attack_up)) return { anim: a.attack_down || a.attack_up, flip: false };
    }
    return { anim: a.walk_down || a.idle || Object.values(a)[0], flip: false };
  }

  // Dibuja con los pies en (x, y). rot ≠ 0 → gira alrededor del centro. flip → espejo horizontal.
  draw(ctx, k, anim, frame, x, y, size, rot = 0, flip = false) {
    const c = this.m.sprites[k].cell;
    const f = ((frame % anim.frames) + anim.frames) % anim.frames;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    if (rot) {
      ctx.translate(0, -size / 2);
      ctx.rotate(rot);
      ctx.drawImage(this.img[k], f * c, anim.row * c, c, c, -size / 2, -size / 2, size, size);
    } else {
      ctx.drawImage(this.img[k], f * c, anim.row * c, c, c, -size / 2, -size, size, size);
    }
    ctx.restore();
  }

  // Imagen de efecto centrada, con rotación opcional (los efectos miran a la derecha).
  drawFx(ctx, name, x, y, size, rot = 0, alpha = 1) {
    const im = this.fx[name];
    if (!im) return false;
    const k = size / Math.max(im.width, im.height);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(im, -im.width * k / 2, -im.height * k / 2, im.width * k, im.height * k);
    ctx.restore();
    return true;
  }

  // Cofre: tier ∈ tech | gold | cosmic, open → abierto.
  drawChest(ctx, tier, open, x, y, size) {
    if (!this.chests || !this.m.chests) return false;
    const i = this.m.chests.frames.indexOf(`${tier}_${open ? 'open' : 'closed'}`);
    if (i < 0) return false;
    const c = this.m.chests.cell;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.chests, i * c, 0, c, c, x - size / 2, y - size * 0.75, size, size);
    ctx.restore();
    return true;
  }

  uiEntry(k) { return this.m && this.m.ui ? this.m.ui[k] : null; }

  // Estilo CSS para mostrar el primer frame en el lobby.
  avatarStyle(k, px) {
    if (!this.has(k)) return null;
    const e = this.m.sprites[k];
    const anims = Object.values(e.anims);
    const cols = Math.max(...anims.map((a) => a.frames));
    const row = (e.anims.walk_down || e.anims.idle || anims[0]).row;
    return `background-image:url(${this.base}${e.file});background-size:${cols * px}px ${anims.length * px}px;background-position:0 -${row * px}px;image-rendering:pixelated;background-repeat:no-repeat`;
  }
}
