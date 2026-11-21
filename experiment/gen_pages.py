#!/usr/bin/env python3
"""
Generate one experiment page per (application, configuration).

Each configuration is a loader bundle plus page settings (chunk profile, frame
budget, VIA request order, number of priority levels, measurement options). For
every application the original page is left untouched; instead this script writes

    <app>/index.exp-<config>.html            (entry page; for tale also html/Beach.exp-<config>.html)
    <app>/<lib>/my-aframe-<bundle>.js        (copied from experiment/bundles/)
    <app>/exp-measure.js                     (copied from experiment/exp-measure.js)

and a manifest experiment/pages.json listing the URL of every page relative to
the server root (code/realCase). Switching configuration is only a matter of
opening a different URL; the runner selects pages by experiment set.

Sets:
    main     M6/M7: baselines, ablation and chunk configurations (Fast 4G)
    look     the main configurations with the camera turning at 30 deg/s from TTFF
             on, so that models loaded during the run come into view
    levels   R1-1/R1-2: 2/3/4 priority levels x static / turn-away / look-around view
    stress   R2-2: artificial render load (constant / varying) for the schedulers
    stages   R2-1: per-model processing-stage benchmark (index.exp-stages.html,
             exp-stages.js; one page per application)

Chunk attributes are written the same way as model-splitter/apply_chunks.py, from
model-splitter/results/<app>/chunk_report_<profile>.json; the chunk files must
already exist in the application directory (they are checked, never copied).
Configurations that need the probe output (experiment/probe/<app>.json, from
runner/probe.mjs) are skipped with a warning until it exists.

Usage:
    python3 experiment/gen_pages.py            # generate all pages
    python3 experiment/gen_pages.py --clean    # remove all generated files
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

EXP_DIR = Path(__file__).resolve().parent
ROOT = EXP_DIR.parent
REALCASE = ROOT / "realCase"
BUNDLES = EXP_DIR / "bundles"
PROBE_DIR = EXP_DIR / "probe"

# Application layout. `scene` is the file containing <a-assets>; for tale it is
# fetched by index.js as ./html/<_enviro>.html.
APPS = {
    "tale": {"dir": "EllieTale-WebXR-main", "entry": "index.html", "scene": "html/Beach.html", "lib": "lib"},
    "hallo": {"dir": "hallovreen-master", "entry": "index.html", "scene": "index.html", "lib": "mylib"},
    "mus": {"dir": "Virtual-Reality-Museum-master", "entry": "index.html", "scene": "index.html", "lib": "mylib"},
}

# Chunk profiles 4g_20/30/50 are the paper's #120/#130/#150 (Pixel 6, Fast 4G);
# #100 (no chunking) is the no-chunk configuration.
PROFILES = ["4g_20", "4g_30", "4g_50"]

# Chunk profile used by the follow-up experiments (levels, stress): the best
# configuration per application in the paper (Table chunk-maxft). Update it after
# the main session if the rerun selects a different one, then regenerate.
BEST_PROFILE = {"tale": "4g_50", "hallo": "4g_30", "mus": "4g_20"}

MOTIONS = {
    "static": None,
    "turn-away": {"type": "turn-away", "degrees": 180, "durationMs": 1000},
    "look-around": {"type": "look-around", "degrees": 360, "durationMs": 12000},
}

RENDER_LOADS = {
    "const10": {"type": "const", "ms": 10},
    "const20": {"type": "const", "ms": 20},
    "wave": {"type": "wave", "minMs": 0, "maxMs": 16, "periodMs": 2000},
}
STRESS_MAX_DURATION_MS = 120000


def build_configs() -> list[dict]:
    """Every configuration as a dict; `chunk` may be 'best' (resolved per app)."""
    c = []

    def add(name, set_, bundle, **kw):
        c.append({"name": name, "set": set_, "bundle": bundle, "chunk": None, "budget": True,
                  "via": False, "gpu": False, "levels": 3, "exp": {}, **kw})

    # main (M6/M7)
    add("baseline", "main", "baseline")
    add("progressive", "main", "progressive")
    add("via", "main", "progressive", via=True)
    add("unthrottled", "main", "priority-only")
    add("no-chunk", "main", "no-chunk")
    for p in PROFILES:
        add(f"prism-{p}", "main", "prism", chunk=p)
    for p in PROFILES:
        add(f"nobudget-{p}", "main", "prism", chunk=p, budget=False)
    # PrismLoader that also schedules GPU preparation (texture upload, shader compile)
    for p in PROFILES:
        add(f"prismgpu-{p}", "main", "prism", chunk=p, gpu=True)

    # look: the same configurations under head motion
    for cfg in [dict(x) for x in c if x["set"] == "main"]:
        cfg.update(name=f"{cfg['name']}-look", set="look", exp={"motion": {"type": "spin", "degPerSec": 30}})
        c.append(cfg)

    # levels (R1-1/R1-2): PrismLoader with the best chunk profile
    for levels in (2, 3, 4):
        for motion, spec in MOTIONS.items():
            exp = {"visibility": True}
            if spec:
                exp["motion"] = spec
            add(f"levels{levels}-{motion}", "levels", "prism", chunk="best", levels=levels, exp=exp)

    # stress (R2-2)
    for load_name, load in RENDER_LOADS.items():
        exp = {"renderLoad": load, "maxDurationMs": STRESS_MAX_DURATION_MS}
        add(f"prism-{load_name}", "stress", "prism", chunk="best", exp=exp)
        add(f"nobudget-{load_name}", "stress", "prism", chunk="best", budget=False, exp=exp)
        add(f"unthrottled-{load_name}", "stress", "priority-only", exp=exp)
    return c


STAGES_PAGE = """<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Stage benchmark</title>
    <script src="{lib}/my-aframe-baseline.js"></script>
    <style>html, body {{ margin: 0; height: 100%; background: #000; }} #ttff-start-button {{ position: fixed; z-index: 10; top: 40%; left: 40%; font-size: 24px; }}</style>
  </head>
  <body>
    <button id="ttff-start-button">START</button>
    <a-scene embedded style="width: 100%; height: 100%;" loading-screen="enabled: false" vr-mode-ui="enabled: false"{renderer}></a-scene>
    <script>window.__EXP_CONFIG__ = {config};</script>
    <script src="exp-stages.js"></script>
  </body>
</html>
"""

MEASURE_TAG = '<script src="ttff-measurement-main.js"></script>'
GEN_MARK = ".exp-"


def replace_once(text: str, old: str, new: str, where: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"[error] expected exactly one {old!r} in {where}, found {count}")
    return text.replace(old, new)


def load_chunk_counts(app: str, profile: str) -> dict:
    """src -> chunk count (>= 2) from chunk_report_<profile>.json; other models are not chunked."""
    report = ROOT / "model-splitter" / "results" / app / f"chunk_report_{profile}.json"
    rows = json.loads(report.read_text(encoding="utf-8"))
    counts = {}
    for row in rows:
        src, actual = row.get("模型"), row.get("实际")
        if isinstance(src, str) and isinstance(actual, int) and actual >= 2:
            counts[src] = actual
    return counts


def load_probe(app: str) -> dict | None:
    path = PROBE_DIR / f"{app}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def level_map(probe: dict, levels: int) -> dict:
    """asset id -> new priority for the priority-granularity experiment (R1-2).

    2 levels: P1 | everything else.  3 levels: the original assignment.
    4 levels: the original assignment, with the non-P1 level that has the most
    model assets split in two by the VIA angle (assets closer to the initial view
    direction first; assets without geometry, e.g. sounds, go to the later half)."""
    orig = {a["id"]: a["priority"] for a in probe["assets"]}
    if levels == 3:
        return orig
    if levels == 2:
        return {k: (1 if p == 1 else 2) for k, p in orig.items()}
    if levels != 4:
        raise ValueError(levels)
    groups = {p: [a for a in probe["assets"] if a["priority"] == p] for p in set(orig.values()) if p != 1}
    split = max(groups, key=lambda p: (sum(a["angle"] is not None for a in groups[p]), -p))
    members = sorted(groups[split], key=lambda a: (a["angle"] is None, a["angle"] or 0.0))
    first_half = {a["id"] for a in members[: (len(members) + 1) // 2]}
    out = {}
    for k, p in orig.items():
        if p < split:
            out[k] = p
        elif p == split:
            out[k] = p if k in first_half else p + 1
        else:
            out[k] = p + 1
    return out


def patch_scene(html: str, cfg: dict, counts: dict, priorities: dict | None, via_ranks: dict | None,
                app_root: Path, where: str) -> str:
    """Rewrite <a-assets> / <a-asset-item> attributes for one configuration."""
    profile = cfg["chunk"]
    out = []
    seen = set()
    for line in html.splitlines(keepends=True):
        commented = line.strip().startswith("<!--")
        if "<a-assets" in line and not commented:
            line = re.sub(r'\s+(chunk-profile|frame-budget|load-order|gpu-prepare|task-log)="[^"]*"', "", line)
            extra = ""
            if profile:
                extra += f' chunk-profile="{profile}"'
            if not cfg["budget"]:
                extra += ' frame-budget="off"'
            if cfg["via"]:
                extra += ' load-order="via"'
            if cfg["gpu"]:
                extra += ' gpu-prepare="on"'
            if cfg["bundle"] == "prism":
                extra += ' task-log="on"'
            pos = line.find(">")
            line = line[:pos] + extra + line[pos:]
        if "<a-asset-item" in line:
            line = re.sub(r'\s+(chunked|chunk-count|chunk-format|via-rank)="[^"]*"', "", line)
            m_src = re.search(r'src="([^"]+)"', line)
            m_id = re.search(r'\sid="([^"]+)"', line)
            if not commented and m_id and priorities is not None and m_id.group(1) in priorities:
                line = re.sub(r'priority="\d+"', f'priority="{priorities[m_id.group(1)]}"', line)
            extra = ""
            if not commented and m_id and via_ranks and m_id.group(1) in via_ranks:
                extra += f' via-rank="{via_ranks[m_id.group(1)]}"'
            if profile and m_src and m_src.group(1) in counts and not commented:
                src, n = m_src.group(1), counts[m_src.group(1)]
                for i in range(1, n + 1):
                    chunk = app_root / f"{src}_split_{profile}_{n}chunks" / f"model_chunk_{i}.gltf"
                    if not chunk.is_file():
                        raise SystemExit(f"[error] missing chunk file for {where}: {chunk}")
                seen.add(src)
                extra += f' chunked="true" chunk-count="{n}"'
            if extra:
                m_resp = re.search(r"\sresponse-type=", line)
                pos = m_resp.start() if m_resp else line.find(">")
                line = line[:pos] + extra + line[pos:]
        out.append(line)
    if profile:
        unused = sorted(set(counts) - seen)
        if unused:
            print(f"[warn] {where}: chunk report models not referenced by the page: {unused}")
    return "".join(out)


def generated_files(app_root: Path, spec: dict):
    yield from app_root.rglob(f"*{GEN_MARK}*.html")
    yield from (app_root / spec["lib"]).glob("my-aframe-*.js")
    yield app_root / "exp-measure.js"
    yield app_root / "exp-stages.js"


def clean() -> None:
    for spec in APPS.values():
        app_root = REALCASE / spec["dir"]
        for path in generated_files(app_root, spec):
            if path.is_file():
                path.unlink()
                print(f"[clean] {path.relative_to(ROOT)}")
    manifest = EXP_DIR / "pages.json"
    if manifest.is_file():
        manifest.unlink()


def generate() -> None:
    configs = build_configs()
    needed = sorted({c["bundle"] for c in configs})
    missing = [b for b in needed if not (BUNDLES / f"my-aframe-{b}.js").is_file()]
    if missing:
        raise SystemExit(f"[error] missing bundles {missing}; run experiment/build_bundles.sh first")

    # Old generated pages may belong to configurations that no longer exist.
    for spec in APPS.values():
        for path in (REALCASE / spec["dir"]).rglob(f"*{GEN_MARK}*.html"):
            path.unlink()

    pages = []
    skipped = []
    for app, spec in APPS.items():
        app_root = REALCASE / spec["dir"]
        entry_src = (app_root / spec["entry"]).read_text(encoding="utf-8")
        scene_src = (app_root / spec["scene"]).read_text(encoding="utf-8")
        separate_scene = spec["scene"] != spec["entry"]
        probe = load_probe(app)

        for bundle in needed:
            shutil.copy2(BUNDLES / f"my-aframe-{bundle}.js", app_root / spec["lib"] / f"my-aframe-{bundle}.js")
        shutil.copy2(EXP_DIR / "exp-measure.js", app_root / "exp-measure.js")
        shutil.copy2(EXP_DIR / "exp-stages.js", app_root / "exp-stages.js")

        # stages (R2-1): one benchmark page per application, all model assets.
        if probe is None:
            skipped.append(f"{app}/stages")
        else:
            models = [{"id": a["id"], "src": a["src"], "priority": a["priority"]} for a in probe["assets"]
                      if a["src"] and a["src"].lower().endswith((".gltf", ".glb"))]
            m_renderer = re.search(r'<a-scene[^>]*?\s(renderer="[^"]*")', scene_src, re.S)
            renderer = " " + " ".join(m_renderer.group(1).split()) if m_renderer else ""
            stage_cfg = {"app": app, "config": "stages", "set": "stages", "bundle": "baseline", "models": models}
            stage_out = app_root / f"index{GEN_MARK}stages.html"
            stage_out.write_text(STAGES_PAGE.format(lib=spec["lib"], renderer=renderer,
                                                    config=json.dumps(stage_cfg)), encoding="utf-8")
            pages.append({"app": app, "config": "stages", "set": "stages", "bundle": "baseline",
                          "chunkProfile": None, "url": f"/{spec['dir']}/{stage_out.name}"})

        for base_cfg in configs:
            cfg = dict(base_cfg)
            name = cfg["name"]
            where = f"{app}/{name}"
            if cfg["chunk"] == "best":
                cfg["chunk"] = BEST_PROFILE[app]
            needs_probe = cfg["via"] or cfg["levels"] != 3 or cfg["exp"].get("visibility")
            if needs_probe and probe is None:
                skipped.append(where)
                continue

            counts = load_chunk_counts(app, cfg["chunk"]) if cfg["chunk"] else {}
            priorities = level_map(probe, cfg["levels"]) if cfg["levels"] != 3 else None
            via_ranks = {a["id"]: a["viaRank"] for a in probe["assets"] if a.get("viaRank")} if cfg["via"] else None
            scene = patch_scene(scene_src, cfg, counts, priorities, via_ranks, app_root, where)
            entry = scene if not separate_scene else entry_src

            page_cfg = {"app": app, "config": name, "set": cfg["set"], "bundle": cfg["bundle"],
                        "chunkProfile": cfg["chunk"], "frameBudget": cfg["budget"], "via": cfg["via"], "gpuPrepare": cfg["gpu"],
                        "levels": cfg["levels"]}
            for key, value in cfg["exp"].items():
                if key == "visibility":
                    page_cfg["visibility"] = [
                        {"key": e["key"], "asset": e["asset"], "min": e["min"], "max": e["max"]}
                        for e in probe["entities"] if "min" in e]
                else:
                    page_cfg[key] = value

            lib_tag = f'<script src="{spec["lib"]}/my-aframe.js"></script>'
            entry = replace_once(entry, lib_tag, f'<script src="{spec["lib"]}/my-aframe-{cfg["bundle"]}.js"></script>', where)
            entry = replace_once(
                entry, MEASURE_TAG,
                f"<script>window.__EXP_CONFIG__ = {json.dumps(page_cfg)};</script>\n"
                '    <script src="exp-measure.js"></script>', where)

            if separate_scene:
                scene_path = app_root / spec["scene"]
                scene_out = scene_path.with_name(f"{scene_path.stem}{GEN_MARK}{name}{scene_path.suffix}")
                scene_out.write_text(scene, encoding="utf-8")
                # tale: index.js fetches ./html/<_enviro>.html on document ready; point it to the generated scene.
                entry = replace_once(
                    entry, '<script src="index.js"></script>',
                    f'<script src="index.js"></script>\n    <script>_enviro = "{scene_out.stem}";</script>', where)

            entry_path = app_root / spec["entry"]
            entry_out = entry_path.with_name(f"{entry_path.stem}{GEN_MARK}{name}{entry_path.suffix}")
            entry_out.write_text(entry, encoding="utf-8")
            pages.append({"app": app, "config": name, "set": cfg["set"], "bundle": cfg["bundle"],
                          "chunkProfile": cfg["chunk"], "url": f"/{spec['dir']}/{entry_out.name}"})

    (EXP_DIR / "pages.json").write_text(json.dumps(pages, indent=2) + "\n", encoding="utf-8")
    by_set = {}
    for p in pages:
        by_set[p["set"]] = by_set.get(p["set"], 0) + 1
    print(f"[done] {len(pages)} pages {by_set}, manifest experiment/pages.json")
    if skipped:
        print(f"[warn] {len(skipped)} pages skipped until experiment/probe/<app>.json exists "
              f"(run: cd experiment/runner && node probe.mjs): {', '.join(skipped[:6])}{' ...' if len(skipped) > 6 else ''}")


def main(argv) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--clean", action="store_true", help="remove all generated files")
    args = parser.parse_args(argv)
    clean() if args.clean else generate()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
