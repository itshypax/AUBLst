"""Leitstellen-Bilder (347x173 webp) der Hypax-Submod-Fahrzeuge aus ihren Prototypen rendern.

Nutzt den Renderer der Submod (Scripts/vehicle_icons.py). Schreibt die Bilder und eine
Vergleichsseite index.html nach <out>; gewählte Bilder kommen nach
frontend/public/vehicles/AUBMP_Hypax_Submod/ und in deren manifest.json.

    python -I -B scripts/render-submod-vehicles.py "<Mods>/AUBMP Hypax Submod" . <out>
"""
import json
import sys
from pathlib import Path

mod, repo, out = map(Path, sys.argv[1:4])
sys.path.insert(0, str(mod / "Scripts"))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
import vehicle_icons as vi  # noqa: E402


def cam_width(proto: str) -> float:
    """Projected width in world units, the way render_mesh sees the vehicle."""
    pos = vi.assemble(proto)[0]
    a, e = np.radians(vi.AZIMUTH), np.radians(vi.ELEVATION)
    c = np.array([np.cos(e) * np.sin(a), -np.cos(e) * np.cos(a), np.sin(e)])
    r = np.cross([0, 0, 1], c)
    r /= np.linalg.norm(r)
    x = pos @ r
    return float(x.max() - x.min())


def lst_image(proto: str, k: float) -> Image.Image:
    """One scale for every vehicle like the handbook images: bottom at y 161, centred."""
    car = vi.render(proto, max(1, round(cam_width(proto) * k * 3)))
    car = car.crop(car.getbbox())
    car = car.resize((max(1, round(car.width / 3)), max(1, round(car.height / 3))), Image.LANCZOS)
    if car.width > W or car.height > 158:
        f = min(W / car.width, 158 / car.height)
        car = car.resize((round(car.width * f), round(car.height * f)), Image.LANCZOS)
    out = Image.new("RGBA", (W, H))
    out.alpha_composite(car, ((W - car.width) // 2, 161 - car.height))
    return out

IDS = ["1_KDOW_1", "2_WLF_K_1", "3_WLF_1", "2_MLF_1", "4_ORGL_1", "32_NEF_A", "34_NEF_A", "35_NEF_A",
       "36_NEF_A", "37_NEF_A", "4_RTW_A", "4_RTW_B", "4_RTW_R", "5_ITW_A", "6_RTW_A", "6_RTW_B", "7_RTW_A", "7_RTW_B", "1_HLF_1"]
W, H = 347, 173


def today(vid: str) -> str:
    """The AUBMP image the Leitstelle shows for vid without own rules."""
    station, kind = vid.split("_")[:2]
    for r in json.loads((repo / "frontend/public/vehicles/AUBMP/manifest.json").read_text())["icons"]:
        if r.get("game_vehicle_id", vid) == vid and r.get("type", kind) == kind and station in r.get("stations", [station]):
            return r["file"]
    return ""


def proto_of(vid: str) -> str:
    return str(next(mod.glob(f"Prototypes/Vehicles/0[1-4]*/{vid}.e4p")).relative_to(mod)).replace("\\", "/")


# 1-HLF-1 is 262 px wide in the handbook's HLF1.webp
K = 262 / cam_width(proto_of("1_HLF_1"))
out.mkdir(parents=True, exist_ok=True)
rows = []
for vid in IDS:
    img = lst_image(proto_of(vid), K)
    img.save(out / f"{vid}.webp", quality=90, method=6)
    old = today(vid)
    if old:
        (out / f"alt_{old}").write_bytes((repo / "frontend/public/vehicles/AUBMP" / old).read_bytes())
    rows.append((vid, old))
    print(vid, old or "-", flush=True)

cells = "".join(
    f'<tr><th>{v.replace("_", "-")}</th><td>{f"<img src=alt_{o}><br>{o}" if o else "kein Bild"}</td>'
    f'<td><img src="{v}.webp"></td></tr>' for v, o in rows)
(out / "index.html").write_text(
    "<!doctype html><meta charset=utf-8><title>Submod-Bilder Vorschau</title><style>body{font:14px system-ui;"
    "background:#1d2430;color:#dde}table{border-collapse:collapse}td,th{border:1px solid #445;padding:6px;"
    "text-align:center}img{background:#fff;width:347px;height:173px}</style><h1>Leitstelle: Submod-Fahrzeuge</h1>"
    f"<table><tr><th>Fahrzeug</th><th>heute (AUBMP-Bild)</th><th>neu (aus dem Modell)</th></tr>{cells}</table>",
    encoding="utf-8")
