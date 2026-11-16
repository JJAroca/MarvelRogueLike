#!/usr/bin/env python3
"""
Procesador y recortador de hojas de sprites.

  python scripts/process_sprites.py            # genera public/sprites_processed/
  python scripts/process_sprites.py --debug    # además, hojas de depuración numeradas

Requisitos: pip install pillow numpy

1. Quita el fondo cuadriculado gris/blanco (o usa el alfa que ya trae Hulk.png) → transparencia real.
2. Genera ghost-rider-normal (llamas naranja/fuego) a partir de Ghost-Rider-Blue.jpg.
3. Detecta cada sprite, lo alinea por los pies (centro inferior) en celdas uniformes
   de 64x64 (96x96 para Hulk, Hulk-Buster, Magneto y Carnage) con UNA escala por hoja,
   para que no vibre al animarse.
4. Escribe una hoja por personaje (una fila por animación) + manifest.json.
Nunca modifica ni borra los originales de sprites/.
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'sprites'
OUT = ROOT / 'public' / 'sprites_processed'


def find_src(name):
    """Busca la hoja original por nombre en sprites/ y sus subcarpetas (herosprite/, boss/, enemies/...)."""
    direct = SRC / name
    if direct.exists():
        return direct
    hits = sorted(SRC.rglob(name))
    return hits[0] if hits else None

# ─────────────────────────────────────────────────────────────────────────────
# Configuración por hoja. Las animaciones se definen por (fila, índices) sobre la
# rejilla DETECTADA (filas de arriba a abajo, sprites de izquierda a derecha).
#   'flip': True  → la animación se genera espejando horizontalmente esos frames.
# ─────────────────────────────────────────────────────────────────────────────
SHEETS = {}  # se rellena más abajo (ver CONFIG)


# ───────────────────────────── Fondo → transparencia ─────────────────────────
def remove_background(img):
    """Devuelve RGBA con el fondo cuadriculado (gris/blanco) eliminado."""
    if img.mode == 'RGBA':
        a = np.array(img)
        if (a[..., 3] < 10).mean() > 0.2:          # ya trae transparencia (Hulk.png)
            alpha = a[..., 3]
            alpha = np.where(alpha < 110, 0, 255).astype(np.uint8)
            a[..., 3] = alpha
            return a
        img = img.convert('RGB')
    rgb = np.array(img.convert('RGB')).astype(np.int16)
    h, w, _ = rgb.shape
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = mx - mn
    lum = rgb.mean(axis=2)

    # Colores del cuadriculado: muestras poco saturadas del borde de la imagen.
    border = np.concatenate([lum[:12].ravel(), lum[-12:].ravel(), lum[:, :12].ravel(), lum[:, -12:].ravel()])
    bsat = np.concatenate([sat[:12].ravel(), sat[-12:].ravel(), sat[:, :12].ravel(), sat[:, -12:].ravel()])
    vals = border[bsat < 20]
    lo_c, hi_c = np.percentile(vals, 5), np.percentile(vals, 95)
    c1, c2 = float(lo_c), float(hi_c)
    for _ in range(8):                               # k-means 1D con 2 centros
        m = np.abs(vals - c1) < np.abs(vals - c2)
        if m.any(): c1 = float(vals[m].mean())
        if (~m).any(): c2 = float(vals[~m].mean())
    tol = max(14.0, abs(c2 - c1) * 0.45)
    cand = (sat < 24) & ((np.abs(lum - c1) < tol) | (np.abs(lum - c2) < tol))

    # Solo es fondo lo candidato conectado al borde o en regiones grandes (huecos entre brazos);
    # así no se borran grises sueltos dentro del sprite (p. ej. el metal de Mini-Ultron).
    labels, sizes, touches = label_components(cand)
    near1 = np.abs(lum - c1) < np.abs(lum - c2)
    n1 = np.bincount(labels.ravel(), weights=near1.ravel(), minlength=len(sizes))
    keep = np.zeros(len(sizes), bool)
    for i in range(1, len(sizes)):
        if touches[i] or sizes[i] > 1500:
            keep[i] = True
        elif sizes[i] >= 40:
            # Hueco cerrado (entre brazos/zarcillos): es fondo solo si contiene los DOS
            # tonos del cuadriculado; un brillo blanco uniforme (ojos, dientes) se conserva.
            f1 = n1[i] / sizes[i]
            keep[i] = 0.12 < f1 < 0.88
    bg = keep[labels]

    alpha = np.where(bg, 0, 255).astype(np.uint8)
    alpha = clean_alpha(alpha)
    # Motas opacas pequeñas que en realidad son restos grises del cuadriculado.
    op_labels, op_sizes, _ = label_components(alpha > 0)
    grey = cand.ravel().astype(np.float64)
    g_frac = np.bincount(op_labels.ravel(), weights=grey, minlength=len(op_sizes)) / np.maximum(op_sizes, 1)
    drop = (op_sizes < 4000) & (g_frac > 0.6)
    drop[0] = False
    alpha[drop[op_labels]] = 0
    out = np.dstack([rgb.astype(np.uint8), alpha])
    return out


def remove_panel_background(img):
    """Hojas con paneles grises sobre fondo oscuro y rótulos de texto (Ultron, Ladrones).
    Todo lo que queda fuera de los paneles (marcos, rótulos) se vuelve transparente; dentro
    de cada panel se elimina el suelo gris conectado al borde del panel. El contorno negro
    del pixel art hace de barrera, así que el metal gris del personaje se conserva."""
    rgb = np.array(img.convert('RGB')).astype(np.int16)
    h, w, _ = rgb.shape
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    # 1. Paneles: zonas de gris medio (el marco/separador es más oscuro, lum < ~55).
    f = 4
    hs, ws = h // f, w // f
    small_l = lum[:hs * f, :ws * f].reshape(hs, f, ws, f).mean(axis=(1, 3))
    small_s = sat[:hs * f, :ws * f].reshape(hs, f, ws, f).mean(axis=(1, 3))
    panelish = (small_l > 60) & (small_s < 40)
    labels, sizes, _ = label_components(panelish)
    alpha = np.zeros((h, w), np.uint8)
    panels = []
    for i in range(1, len(sizes)):
        if sizes[i] < 400:          # rótulos y motas
            continue
        ys, xs = np.nonzero(labels == i)
        x0, y0, x1, y1 = xs.min() * f, ys.min() * f, (xs.max() + 1) * f, (ys.max() + 1) * f
        if (x1 - x0) < 60 or (y1 - y0) < 60:
            continue
        panels.append((x0, y0, x1, y1))
    for x0, y0, x1, y1 in panels:
        sub = rgb[y0:y1, x0:x1]
        sl, ss = lum[y0:y1, x0:x1], sat[y0:y1, x0:x1]
        ring = np.concatenate([sub[:6].reshape(-1, 3), sub[-6:].reshape(-1, 3), sub[:, :6].reshape(-1, 3), sub[:, -6:].reshape(-1, 3)])
        ring_l = ring.mean(axis=1)
        ref = np.median(ring[(ring_l > 55)], axis=0) if (ring_l > 55).any() else np.median(ring, axis=0)
        dist = np.abs(sub - ref).max(axis=2)
        cand = (ss < 34) & (sl > 44) & (sl < 128) & (dist < 46)
        lab, sz, touch = label_components(cand)
        bg = touch.copy()
        bg[0] = False
        flood_bg = bg[lab]
        # El metal gris del personaje se parece demasiado al suelo: lo que queda DENTRO
        # del contorno negro del pixel art (relleno de huecos) siempre es personaje.
        try:
            from scipy import ndimage
            dark = sl < 42
            closed = ndimage.binary_closing(dark, structure=np.ones((3, 3)), iterations=1)
            filled = ndimage.binary_fill_holes(closed)
            fl, nf = ndimage.label(filled)
            if nf:
                area = np.bincount(fl.ravel(), minlength=nf + 1)
                darkc = np.bincount(fl.ravel(), weights=dark.ravel().astype(np.float64), minlength=nf + 1)
                keep = (area > 300) & ((area - darkc) > 0.3 * area)
                keep[0] = False
                inside = keep[fl]
            else:
                inside = np.zeros_like(dark)
            a = np.where(inside | ~flood_bg, 255, 0).astype(np.uint8)
        except ImportError:
            a = np.where(flood_bg, 0, 255).astype(np.uint8)
        a = clean_alpha(a)
        # Quitar islas pequeñas (grietas del suelo, motas) que no son parte del personaje.
        ol, osz, _ = label_components(a > 0)
        if len(osz) > 1:
            big = osz.max()
            drop = osz < max(60, big * 0.04)
            drop[0] = False
            a[drop[ol]] = 0
        # Líneas finas sueltas (separadores entre viñetas del panel).
        try:
            from scipy import ndimage
            ol, n = ndimage.label(a > 0)
            for k, sl_ in enumerate(ndimage.find_objects(ol), start=1):
                hh, ww = sl_[0].stop - sl_[0].start, sl_[1].stop - sl_[1].start
                if min(hh, ww) <= 6 and max(hh, ww) >= 20:
                    a[sl_][ol[sl_] == k] = 0
        except ImportError:
            pass
        alpha[y0:y1, x0:x1] = a
    return np.dstack([rgb.astype(np.uint8), alpha])


def remove_dark_background(img, lo=26, span=46):
    """Efectos sobre fondo oscuro liso: alfa suave según la distancia al color de fondo
    (des-premultiplicado para que los brillos no queden con halo negro)."""
    a = np.array(img.convert('RGB')).astype(np.float32)
    border = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    bgc = np.median(border, axis=0)
    dist = np.abs(a - bgc).max(axis=2)
    al = np.clip((dist - lo) / span, 0, 1)
    out = np.zeros(a.shape[:2] + (4,), np.float32)
    safe = np.maximum(al, 1e-3)[..., None]
    out[..., :3] = np.clip((a - bgc * (1 - al[..., None])) / safe, 0, 255)
    out[..., 3] = al * 255
    out[al <= 0.02] = 0
    return out.astype(np.uint8)


def label_components(mask):
    """Etiquetado 4-conexo. Devuelve (labels, sizes, touches_border).
    Usa scipy si está instalado (rápido); si no, un BFS en Python puro."""
    try:
        from scipy import ndimage
        labels, n = ndimage.label(mask)
        sizes = np.bincount(labels.ravel(), minlength=n + 1)
        sizes[0] = 0
        touches = np.zeros(n + 1, bool)
        for edge in (labels[0], labels[-1], labels[:, 0], labels[:, -1]):
            touches[np.unique(edge)] = True
        touches[0] = False
        return labels, sizes, touches
    except ImportError:
        pass
    h, w = mask.shape
    labels = np.zeros((h, w), np.int32)
    sizes = [0]
    touches = [False]
    cur = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if labels[y0, x0]:
            continue
        cur += 1
        size = 0
        touch = False
        dq = deque([(y0, x0)])
        labels[y0, x0] = cur
        while dq:
            y, x = dq.popleft()
            size += 1
            if y == 0 or x == 0 or y == h - 1 or x == w - 1:
                touch = True
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = cur
                    dq.append((ny, nx))
        sizes.append(size)
        touches.append(touch)
    return labels, np.array(sizes), np.array(touches)


def clean_alpha(alpha):
    """Quita motas opacas aisladas (ruido JPG del cuadriculado)."""
    op = alpha > 0
    # vecinos opacos en una ventana 3x3
    p = np.pad(op, 1)
    n = sum(p[1 + dy:1 + dy + op.shape[0], 1 + dx:1 + dx + op.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    op &= n >= 4
    return np.where(op, 255, 0).astype(np.uint8)


# ───────────────────────────── Ghost Rider: azul → fuego ─────────────────────
def blue_to_fire(rgba):
    out = rgba.copy()
    rgb = out[..., :3].astype(np.float32) / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    d = mx - mn + 1e-6
    hue = np.zeros_like(mx)
    m = mx == r; hue[m] = ((g - b)[m] / d[m]) % 6
    m = mx == g; hue[m] = (b - r)[m] / d[m] + 2
    m = mx == b; hue[m] = (r - g)[m] / d[m] + 4
    hue *= 60
    sat = d / (mx + 1e-6)
    blue = (hue > 165) & (hue < 260) & (sat > 0.18) & (out[..., 3] > 0)
    # Llamas: tono 10–50° (rojo-naranja → amarillo) según el brillo.
    v = mx
    new_h = 12 + 40 * np.clip((v - 0.35) / 0.65, 0, 1)
    new_s = np.clip(sat * 1.1, 0, 1)
    rgb_new = hsv_to_rgb(new_h, new_s, np.clip(v * 1.05, 0, 1))
    for c in range(3):
        rgb[..., c] = np.where(blue, rgb_new[..., c], rgb[..., c])
    out[..., :3] = (rgb * 255).astype(np.uint8)
    return out


def hsv_to_rgb(h, s, v):
    c = v * s
    hp = (h / 60.0) % 6
    x = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(h)
    conds = [(hp < 1), (hp < 2), (hp < 3), (hp < 4), (hp < 5), (hp >= 5)]
    rgbs = [(c, x, z), (x, c, z), (z, c, x), (z, x, c), (x, z, c), (c, z, x)]
    r = np.select(conds, [t[0] for t in rgbs]); g = np.select(conds, [t[1] for t in rgbs]); b = np.select(conds, [t[2] for t in rgbs])
    m = v - c
    return np.stack([r + m, g + m, b + m], axis=-1)


# ───────────────────────────── Detección de sprites ──────────────────────────
def detect_sprites(rgba):
    """Detecta sprites individuales. Devuelve filas: [[sprite, ...], ...]
    sprite = dict(box=(x0,y0,x1,y1), body=(x0,y0,x1,y1), feet=(cx, by))"""
    alpha = rgba[..., 3] > 0
    h, w = alpha.shape
    # Trabajar a escala reducida para velocidad.
    f = 4
    small = alpha[: h // f * f, : w // f * f].reshape(h // f, f, w // f, f).max(axis=(1, 3))
    labels, sizes, _ = label_components(small)
    comps = []
    for i in range(1, len(sizes)):
        if sizes[i] < 6:
            continue
        ys, xs = np.nonzero(labels == i)
        comps.append(dict(id=i, size=int(sizes[i]), box=[xs.min() * f, ys.min() * f, (xs.max() + 1) * f, (ys.max() + 1) * f]))
    if not comps:
        return []
    # Cuerpo = componente grande respecto a los sprites más grandes de la hoja
    # (los escombros/destellos sueltos se adjuntan luego al cuerpo más cercano).
    ref = float(np.percentile([c['size'] for c in comps], 90))
    bodies = [c for c in comps if c['size'] >= ref * 0.3]
    bits = [c for c in comps if c['size'] < ref * 0.3]
    for b in bodies:
        b['parts'] = [b['box'][:]]
        b['body'] = b['box'][:]
    # Adjuntar piezas sueltas (efectos, escombros, destellos) al cuerpo más cercano.
    for p in bits:
        px = (p['box'][0] + p['box'][2]) / 2; py = (p['box'][1] + p['box'][3]) / 2
        best, bd = None, 1e18
        for b in bodies:
            bx0, by0, bx1, by1 = b['body']
            dx = max(bx0 - px, 0, px - bx1); dy = max(by0 - py, 0, py - by1)
            dd = dx * dx + dy * dy * 4
            if dd < bd: bd, best = dd, b
        bh = best['body'][3] - best['body'][1]
        if bd ** 0.5 < bh * 0.9:
            best['parts'].append(p['box'])
    for b in bodies:
        xs0 = [q[0] for q in b['parts']]; ys0 = [q[1] for q in b['parts']]
        xs1 = [q[2] for q in b['parts']]; ys1 = [q[3] for q in b['parts']]
        b['box'] = [min(xs0), min(ys0), max(xs1), max(ys1)]
        # Pies: punto más bajo del cuerpo y centro de masa de su 25% inferior.
        x0, y0, x1, y1 = b['body']
        sub = alpha[y0:y1, x0:x1]
        rows = np.nonzero(sub.any(axis=1))[0]
        bottom = y0 + rows.max()
        band = sub[max(0, rows.max() - int((y1 - y0) * 0.25)): rows.max() + 1]
        cols = np.nonzero(band)[1]
        cx = x0 + (cols.mean() if len(cols) else (x1 - x0) / 2)
        b['feet'] = (float(cx), int(bottom))
        b['height'] = int(bottom - y0)
    # Agrupar en filas por la posición vertical de los pies.
    bodies.sort(key=lambda b: b['feet'][1])
    rows = []
    for b in bodies:
        if rows and abs(b['feet'][1] - np.mean([q['feet'][1] for q in rows[-1]])) < np.median([q['height'] for q in bodies]) * 0.45:
            rows[-1].append(b)
        else:
            rows.append([b])
    for r in rows:
        r.sort(key=lambda b: b['feet'][0])
    return rows


def render_cell(rgba, sprite, scale, cell):
    """Recorta el sprite y lo coloca en una celda con los pies en el centro inferior."""
    x0, y0, x1, y1 = sprite['box']
    crop = Image.fromarray(rgba[y0:y1, x0:x1])
    nw, nh = max(1, round((x1 - x0) * scale)), max(1, round((y1 - y0) * scale))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    a = np.array(crop)
    a[..., 3] = np.where(a[..., 3] < 70, 0, np.minimum(255, a[..., 3].astype(np.int16) * 1.3)).astype(np.uint8)
    crop = Image.fromarray(a)
    fx, fy = sprite['feet']
    ox = round(cell / 2 - (fx - x0) * scale)
    oy = round((cell - 2) - (fy - y0) * scale)
    canvas = Image.new('RGBA', (cell, cell), (0, 0, 0, 0))
    canvas.alpha_composite(crop, dest=(0, 0), source=(0, 0)) if False else canvas.paste(crop, (ox, oy), crop)
    return canvas




# ───────────────────────────── Configuración ─────────────────────────────────
# name: archivo de salida (clave del manifest). Las animaciones salen de sprite_layout.json:
#   "anim": [fila, [índices]]                    fila/índices de la rejilla DETECTADA
#   "anim": [fila, [índices], "flip"]            espejado horizontal
#   "anim": {"src": 1, "row": f, "idx": [..], "flip": true}   (hojas con varias fuentes)
#   srcs: varias hojas para un mismo personaje.
#   bg='panel': fondo de paneles grises con rótulos (Ultron, Ladrones).
#   outputs: una hoja original → varias hojas de salida (Ladrones → matón y ladrón).
#   facing: hacia dónde mira el dibujo lateral; el cliente lo voltea según el cursor.
CONFIG = [
    dict(src='Ironman.jpg', name='ironman', cell=64),
    dict(src='Hulk-Buster.jpg', name='hulkbuster', cell=96),
    dict(src='Ghost-Rider-Blue.jpg', name='ghost-rider-blue', cell=64, fire_variant='ghost-rider-normal'),
    dict(src='Hulk.png', name='hulk', cell=96),
    dict(src='Banner.jpg', name='banner', cell=64),
    dict(src='Doctor-Strange.png', name='doctor-strange', cell=64),
    dict(src='Magneto.jpg', name='magneto', cell=96),
    dict(srcs=['Carnage1.png', 'Carnage2.png'], name='carnage', cell=96, facing='right'),
    dict(src='Soldado-AIM.jpg', name='soldado-aim', cell=64),
    dict(src='Mini-Ultron.jpg', name='mini-ultron', cell=64),
    # ── Actualización: jefes aleatorios, enemigos comunes y Spider-Man 2099 ──
    dict(src='Juggernaut.png', name='juggernaut', cell=96, facing='right'),
    dict(src='Ultron.jpg', name='ultron', cell=96, bg='panel', facing='right'),
    dict(srcs=['Spiderman2099-1.png', 'Spiderman2099-2.png'], name='spider2099', cell=64, facing='right'),
    dict(src='AIM.jpg', name='aim-laser', cell=64, facing='right'),
    dict(src='Kamikaze.jpg', name='kamikaze', cell=64, facing='right'),
    dict(src='Ladrones.jpg', name='ladrones', cell=64, bg='panel', facing='right', outputs=['thug', 'thief']),
    dict(src='Simbionte.png', name='simbionte', cell=64, facing='right'),
    dict(src='NinjaCibernetico.png', name='ninja', cell=64, facing='right'),
    dict(srcs=['goblin2.jpg', 'goblin1.jpg'], name='goblin', cell=64, facing='right',
         clear_bands=[(0.02, 0.10), (0.50, 0.58)]),
]

# Fondos por bioma: (archivo, recorte relativo x0, y0, x1, y1) → tesela repetible.
STAGES = {
    'aim': ('AIMStage.jpg', (0, 0, 1, 1)),
    'cosmic': ('CosmicStage.jpg', (0, 0, 1, 1)),
    'futurist': ('FuturistStage.jpg', (0.004, 0.006, 0.49, 0.5)),
    'magic': ('MagicStage.jpg', (0.004, 0.006, 0.33, 0.5)),
}
# Piezas del HUD en Barras.jpg (recorte relativo).
UI_PARTS = {
    'hp_frame': (0.050, 0.070, 0.425, 0.275),
    'shield_frame': (0.085, 0.315, 0.380, 0.447),
    'slot': (0.498, 0.080, 0.638, 0.336),
    'slot_rare': (0.649, 0.080, 0.789, 0.336),
    'slot_epic': (0.802, 0.080, 0.942, 0.336),
    'iso': (0.548, 0.672, 0.656, 0.900),
}


def load_layout():
    cfg_path = Path(__file__).with_name('sprite_layout.json')
    return json.loads(cfg_path.read_text(encoding='utf-8')) if cfg_path.exists() else {}


def parse_spec(spec):
    if isinstance(spec, dict):
        return spec.get('src', 0), spec['row'], spec['idx'], bool(spec.get('flip'))
    return 0, spec[0], spec[1], len(spec) > 2 and spec[2] == 'flip'


def build_sheet(name, anims, sources, cell):
    out_rows, manifest_anims = [], {}
    for an, spec in anims.items():
        if an.startswith('_'):
            continue
        si, ri, idxs, flip = parse_spec(spec)
        data, rows, scale = sources[si]
        if ri >= len(rows):
            print(f'  ! {name}: la animación {an} pide la fila {ri} pero solo hay {len(rows)}')
            continue
        frames = []
        for i in idxs:
            if i >= len(rows[ri]):
                continue
            cell_img = render_cell(data, rows[ri][i], scale, cell)
            if flip:
                cell_img = cell_img.transpose(Image.FLIP_LEFT_RIGHT)
            frames.append(cell_img)
        if frames:
            manifest_anims[an] = {'row': len(out_rows), 'frames': len(frames)}
            out_rows.append(frames)
    if not out_rows:
        return None
    cols = max(len(r) for r in out_rows)
    sheet = Image.new('RGBA', (cols * cell, len(out_rows) * cell), (0, 0, 0, 0))
    for ri, frames in enumerate(out_rows):
        for fi, fr in enumerate(frames):
            sheet.paste(fr, (fi * cell, ri * cell), fr)
    sheet.save(OUT / f'{name}.png', optimize=True)
    return manifest_anims


def debug_sheet(rgba, rows, path):
    dbg = Image.fromarray(rgba).convert('RGBA')
    bgc = Image.new('RGBA', dbg.size, (40, 120, 60, 255)); bgc.alpha_composite(dbg)
    d = ImageDraw.Draw(bgc)
    for ri, r in enumerate(rows):
        for si, s in enumerate(r):
            d.rectangle(s['box'], outline=(255, 255, 0, 255), width=4)
            fx, fy = s['feet']; d.ellipse([fx - 8, fy - 8, fx + 8, fy + 8], fill=(255, 0, 255, 255))
            d.text((s['box'][0] + 6, s['box'][1] + 4), f'{ri}:{si}', fill=(255, 255, 255, 255), font_size=40)
    bgc.thumbnail((1600, 1600)); bgc.convert('RGB').save(path, quality=80)


def process(c, layout, debug_dir=None):
    names = c.get('srcs') or [c['src']]
    paths = [find_src(n) for n in names]
    if not all(paths):
        return None
    sources, counts, heights = [], [], []
    for si, path in enumerate(paths):
        img = Image.open(path)
        rgba = remove_panel_background(img) if c.get('bg') == 'panel' else remove_background(img)
        # Franjas con rótulos de texto (p. ej. "IDLE SNEAK" en las hojas del Goblin): se borran.
        for y0, y1 in c.get('clear_bands', []):
            rgba[round(y0 * rgba.shape[0]):round(y1 * rgba.shape[0]), :, 3] = 0
        rows = detect_sprites(rgba)
        hs = [s['height'] for r in rows for s in r]
        # Escala por hoja original: la altura típica del cuerpo ocupa ~84% de la celda.
        sources.append((rgba, rows, (c['cell'] * 0.84) / float(np.percentile(hs, 75))))
        counts.append([len(r) for r in rows])
        heights += hs
        if debug_dir:
            debug_sheet(rgba, rows, debug_dir / f"{c['name']}{'_' + str(si) if len(paths) > 1 else ''}_debug.jpg")
    scale = sources[0][2]
    results = []
    for out in c.get('outputs') or [c['name']]:
        anims = layout.get(out) or {f'row{ri}': [ri, list(range(len(r)))] for ri, r in enumerate(sources[0][1])}
        variants = [(out, sources)]
        if c.get('fire_variant'):
            variants.append((c['fire_variant'], [(blue_to_fire(d), r, k) for d, r, k in sources]))
        for name, srcs in variants:
            ma = build_sheet(name, anims, srcs, c['cell'])
            if ma is None:
                continue
            entry = {'file': f'{name}.png', 'cell': c['cell'], 'anims': ma, 'source': ', '.join(names)}
            facing = (layout.get(out) or {}).get('_facing', c.get('facing'))
            if facing:
                entry['facing'] = facing
            results.append((name, entry))
    print(f"  {', '.join(names):42s} filas={counts} escala={scale:.3f} → {', '.join(n for n, _ in results)}")
    return results


# ───────────────────────────── Ítems, efectos, fondos, cofres, HUD ───────────────
def trim(rgba, pad=2):
    al = rgba[..., 3] > 8
    if not al.any():
        return rgba
    ys, xs = np.nonzero(al)
    y0, y1 = max(0, ys.min() - pad), min(rgba.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(rgba.shape[1], xs.max() + 1 + pad)
    return rgba[y0:y1, x0:x1]


def process_items():
    """Iconos de sprites/items/*.png → items/<Nombre>.png (64x64). El NOMBRE del archivo
    es el id del ítem en el servidor (server/game/items.js)."""
    d = OUT / 'items'
    d.mkdir(exist_ok=True)
    names = []
    for f in sorted((SRC / 'items').glob('*.png')) if (SRC / 'items').exists() else []:
        a = trim(np.array(Image.open(f).convert('RGBA')))
        im = Image.fromarray(a)
        side = max(im.size)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2), im)
        sq.resize((64, 64), Image.LANCZOS).save(d / f.name, optimize=True)
        names.append(f.stem)
    print(f'  items: {len(names)} iconos')
    return names


def process_effects():
    d = OUT / 'fx'
    d.mkdir(exist_ok=True)
    fx = {}
    for f in sorted((SRC / 'output_effects').glob('*.png')) if (SRC / 'output_effects').exists() else []:
        a = trim(remove_dark_background(Image.open(f)))
        im = Image.fromarray(a)
        if max(im.size) > 160:
            k = 160 / max(im.size)
            im = im.resize((max(1, round(im.size[0] * k)), max(1, round(im.size[1] * k))), Image.LANCZOS)
        im.save(d / f.name, optimize=True)
        fx[f.stem] = {'file': f'fx/{f.name}', 'w': im.size[0], 'h': im.size[1]}
    print(f'  efectos: {len(fx)}')
    return fx


def process_stages():
    d = OUT / 'stage'
    d.mkdir(exist_ok=True)
    out = {}
    for key, (fname, (fx0, fy0, fx1, fy1)) in STAGES.items():
        p = find_src(fname)
        if not p:
            continue
        im = Image.open(p).convert('RGB')
        w, h = im.size
        im = im.crop((round(fx0 * w), round(fy0 * h), round(fx1 * w), round(fy1 * h)))
        k = 640 / max(im.size)
        if k < 1:
            im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
        im.save(d / f'{key}.jpg', quality=86)
        out[key] = {'file': f'stage/{key}.jpg', 'w': im.size[0], 'h': im.size[1]}
    print(f'  fondos: {", ".join(out)}')
    return out


def process_chests():
    p = find_src('Chests.jpg')
    if not p:
        return None
    rgba = remove_background(Image.open(p))
    rows = detect_sprites(rgba)
    row = max(rows, key=len)
    if len(row) < 6:
        print(f'  ! cofres: se esperaban 6 y hay {len(row)}')
        return None
    heights = [s['height'] for s in row]
    scale = (64 * 0.9) / max(heights)
    names = ['tech_closed', 'tech_open', 'gold_closed', 'gold_open', 'cosmic_closed', 'cosmic_open']
    sheet = Image.new('RGBA', (64 * 6, 64), (0, 0, 0, 0))
    for i, s in enumerate(row[:6]):
        cimg = render_cell(rgba, s, scale, 64)
        sheet.paste(cimg, (i * 64, 0), cimg)
    sheet.save(OUT / 'chests.png', optimize=True)
    print('  cofres: 6')
    return {'file': 'chests.png', 'cell': 64, 'frames': names}


# Gemas del Infinito (sprites/items/Gemas.jpg): fila/índice de la rejilla detectada → gema.
GEM_PICK = {'espacio': (0, 1), 'mente': (0, 4), 'realidad': (1, 0), 'poder': (1, 2), 'tiempo': (2, 0), 'alma': (3, 1)}


def process_gems():
    p = find_src('Gemas.jpg')
    if not p:
        return None
    rgba = remove_background(Image.open(p))
    rows = detect_sprites(rgba)
    d = OUT / 'gems'
    d.mkdir(exist_ok=True)
    out = {}
    for gid, (ri, ci) in GEM_PICK.items():
        if ri >= len(rows) or ci >= len(rows[ri]):
            print(f'  ! gema {gid}: no se encuentra la fila {ri}:{ci}')
            continue
        x0, y0, x1, y1 = rows[ri][ci]['box']
        a = trim(rgba[y0:y1, x0:x1])
        im = Image.fromarray(a)
        side = max(im.size)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2), im)
        sq.resize((64, 64), Image.LANCZOS).save(d / f'{gid}.png', optimize=True)
        out[gid] = f'gems/{gid}.png'
    print(f'  gemas: {", ".join(out)} (filas detectadas {[len(r) for r in rows]})')
    return out


def process_ui():
    p = find_src('Barras.jpg')
    if not p:
        return None
    d = OUT / 'ui'
    d.mkdir(exist_ok=True)
    full = np.array(Image.open(p).convert('RGB')).astype(np.int16)
    H, W, _ = full.shape
    out = {}
    for key, (x0, y0, x1, y1) in UI_PARTS.items():
        sub = full[round(y0 * H):round(y1 * H), round(x0 * W):round(x1 * W)]
        lum = sub.mean(axis=2)
        sat = sub.max(axis=2) - sub.min(axis=2)
        cand = (lum < 46) & (sat < 22)
        lab, sz, touch = label_components(cand)
        touch[0] = False
        alpha = np.where(touch[lab], 0, 255).astype(np.uint8)
        ol, osz, _ = label_components(alpha > 0)
        if len(osz) > 1:
            keep = osz >= osz.max() * 0.08
            keep[0] = False
            alpha[~keep[ol]] = 0
        rgba = np.dstack([sub.astype(np.uint8), alpha])
        entry = {}
        if key in ('hp_frame', 'shield_frame'):
            # Interior de la barra: zona del relleno de color + el hueco oscuro a su derecha.
            r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
            fill = (r > 150) & (g < 100) if key == 'hp_frame' else (b > 150) & (g > 120) & (r < 120)
            fl_, fs_, _ = label_components(fill)
            fill = fl_ == int(np.argmax(fs_))          # solo la franja principal del relleno
            ys, xs = np.nonzero(fill)
            fy0, fy1, fx0, fx1 = int(np.percentile(ys, 2)), int(np.percentile(ys, 98)), int(xs.min()), int(xs.max())
            mid = (fy0 + fy1) // 2
            # El hueco vacío de la barra acaba en el contorno negro del marco.
            ex = fx1
            for xx in range(fx1 + 4, sub.shape[1]):
                if lum[mid, xx] < 22:
                    ex = xx - 1
                    break
            col = (fx0 + fx1) // 2
            while fy0 > 0 and lum[fy0 - 1, col] >= 22:
                fy0 -= 1
            while fy1 + 1 < sub.shape[0] and lum[fy1 + 1, col] >= 22:
                fy1 += 1
            entry['inner'] = [fx0, fy0, ex - fx0 + 1, fy1 - fy0 + 1]
        ys, xs = np.nonzero(alpha)
        cx0, cy0 = int(xs.min()), int(ys.min())
        rgba = rgba[cy0:ys.max() + 1, cx0:xs.max() + 1]
        if 'inner' in entry:
            entry['inner'][0] -= cx0
            entry['inner'][1] -= cy0
        Image.fromarray(rgba).save(d / f'{key}.png', optimize=True)
        entry.update({'file': f'ui/{key}.png', 'w': int(rgba.shape[1]), 'h': int(rgba.shape[0])})
        out[key] = entry
    print(f'  hud: {", ".join(out)}')
    return out


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')   # consola de Windows (cp1252)
    except Exception:
        pass
    debug = '--debug' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    debug_dir = None
    if debug:
        debug_dir = OUT / '_debug'
        debug_dir.mkdir(exist_ok=True)
    old = {}
    try:
        old = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8')).get('sprites', {})
    except Exception:
        pass
    layout = load_layout()
    manifest = {'version': 2, 'fps': {'walk': 8, 'attack': 12}, 'sprites': {}}
    for c in CONFIG:
        res = process(c, layout, debug_dir)
        if res is None:
            # Falta la hoja original: se conserva la versión ya procesada si existe.
            names = [c['name']] + ([c['fire_variant']] if c.get('fire_variant') else []) + (c.get('outputs') or [])
            kept = [n for n in names if n in old and (OUT / old[n]['file']).exists()]
            for n in kept:
                manifest['sprites'][n] = old[n]
            print(f"  ! falta {c.get('src') or c.get('srcs')}: " + (f"se conserva {', '.join(kept)}" if kept else 'se omite'))
            continue
        for name, entry in res:
            manifest['sprites'][name] = entry
    manifest['items'] = process_items()
    manifest['fx'] = process_effects()
    manifest['stages'] = process_stages()
    manifest['chests'] = process_chests()
    manifest['ui'] = process_ui()
    manifest['gems'] = process_gems()
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Listo: {len(manifest["sprites"])} hojas en {OUT}')


if __name__ == '__main__':
    main()
