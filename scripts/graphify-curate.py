#!/usr/bin/env python3
"""
graphify-curate.py — turn Graphify's 464k-node combined graph into
a ~150-node Mally-readable topology of the live system.

Source : ~/mcp-infra/graphify/combined-<latest>/graph.json   (~629MB)
Output : ~/agent-cockpit/public/flow-graph.json

Aggregation:
  - One node per service unit (MCP / Hermes profile / pipeline / script /
    big-app aggregate). Files inside a unit collapse into the unit.
  - One edge per ordered pair of units that have >=1 underlying file link.
    Weight = count of underlying file links.

Layout: column-by-type, vertical-by-name within column. Stable positions.
"""
from __future__ import annotations

import datetime
import json
import sys
from collections import defaultdict
from pathlib import Path

HOME = Path.home()
SRC_DIR_ROOT = HOME / "mcp-infra" / "graphify"
OUT_PATH = HOME / "agent-cockpit" / "public" / "flow-graph.json"

ORACLE_CODEBASES_KEEP = {
    "oracle-hermes-agent",
    "oracle-mcp-infra",
    "oracle-agent-cockpit",
    "oracle-berlai-ops",
    "oracle-hermes-profiles",
    "oracle-hermes-office",
    "oracle-kanban-mcp",
    "oracle-crawl4ai-mcp",
}
# Mac codebase carve-outs: include selectively. mcp-infra canonical scripts/
# live here, not under oracle-mcp-infra (Oracle Graphify-root differs).
MAC_SCRIPTS_CODEBASE = "mcp-infra"

CODEBASE_TO_APP = {
    "oracle-berlai-ops": ("app:vectos", "VectOS", "app"),
    "oracle-agent-cockpit": ("app:atc", "ATC", "app"),
    "oracle-hermes-agent": ("hermes:brain", "hermes-brain", "hermes"),
    "oracle-hermes-office": ("hermes:office", "hermes-office", "hermes"),
    "oracle-kanban-mcp": ("mcp:kanban-mcp", "kanban-mcp", "mcp"),
    "oracle-crawl4ai-mcp": ("mcp:crawl4ai-mcp", "crawl4ai-mcp", "mcp"),
}

PROFILE_SKIP_PREFIXES = (".retired", ".RETIRED", "henry-personal.bak")

PATH_DROP_TOKENS = (
    "node_modules/",
    "__pycache__/",
    ".next/",
    "dist/",
    "dist_bak_",
    "bundles/",
    "third_party/",
    "web_dist/",
    ".venv/",
    ".pytest_cache/",
    ".claude/worktrees/",
    "archive/",
    ".retired",
    ".bak-",
)

SCRIPT_LABEL_ALIAS = {
    "embeddings-outbox-drainer": "embedding-drainer",
    "meeting-ingest": "meeting-ingest",
}


def find_latest_combined() -> Path:
    candidates = sorted(SRC_DIR_ROOT.glob("combined-*"), reverse=True)
    for c in candidates:
        gj = c / "graph.json"
        if gj.exists():
            return gj
    raise SystemExit(f"No combined-*/graph.json under {SRC_DIR_ROOT}")


def path_dropped(src: str) -> bool:
    return any(tok in src for tok in PATH_DROP_TOKENS)


def classify(node_id: str, source_file: str):
    if "::" not in node_id:
        return None
    codebase, _ = node_id.split("::", 1)
    if path_dropped(source_file):
        return None

    if codebase == MAC_SCRIPTS_CODEBASE:
        parts = source_file.split("/")
        if len(parts) >= 2 and parts[0] == "scripts" and parts[1].endswith(".py"):
            base = parts[1].rsplit(".", 1)[0]
            label = SCRIPT_LABEL_ALIAS.get(base, base)
            return (f"script:{base}", label, "script")
        return None

    if codebase not in ORACLE_CODEBASES_KEEP:
        return None

    if codebase == "oracle-hermes-profiles":
        first = source_file.split("/", 1)[0] if "/" in source_file else source_file
        if not first or first.startswith(PROFILE_SKIP_PREFIXES):
            return None
        return (f"profile:{first}", first, "profile")

    if codebase == "oracle-mcp-infra":
        parts = source_file.split("/")
        if len(parts) >= 2 and parts[0] == "projects":
            name = parts[1]
            return (f"mcp:{name}", name, "mcp")
        if parts and parts[0].endswith("-mcp"):
            name = parts[0]
            return (f"mcp:{name}", name, "mcp")
        if len(parts) >= 2 and parts[0] == "ingest":
            name = parts[1]
            return (f"pipeline:{name}", name, "pipeline")
        if len(parts) >= 2 and parts[0] == "scripts":
            fname = parts[1]
            base = fname.rsplit(".", 1)[0]
            label = SCRIPT_LABEL_ALIAS.get(base, base)
            return (f"script:{base}", label, "script")
        if parts and parts[0] == "agentic":
            return ("hermes:agentic", "hermes-agentic", "hermes")
        return None

    if codebase == "oracle-berlai-ops":
        parts = source_file.split("/")
        if len(parts) >= 5 and parts[:3] == ["src", "app", "api"]:
            area = parts[3]
            resource = parts[4]
            for suf in (".ts", ".tsx", ".js"):
                if resource.endswith(suf):
                    resource = resource[: -len(suf)]
            if resource.startswith("[") and resource.endswith("]"):
                resource = resource[1:-1]
            return (f"api:vectos:{area}:{resource}", f"{area}/{resource}", "api")
        return CODEBASE_TO_APP[codebase]

    if codebase == "oracle-agent-cockpit":
        parts = source_file.split("/")
        if len(parts) >= 5 and parts[:3] == ["src", "routes"] and parts[3] == "api":
            area = parts[4]
            for suf in (".ts", ".tsx", ".js"):
                if area.endswith(suf):
                    area = area[: -len(suf)]
            return (f"api:atc:{area}", f"atc/{area}", "api")
        return CODEBASE_TO_APP[codebase]

    if codebase in CODEBASE_TO_APP:
        return CODEBASE_TO_APP[codebase]
    return None


def main() -> None:
    src = find_latest_combined()
    print(f"[curate] reading {src} ({src.stat().st_size / 1e6:.0f}MB) ...", file=sys.stderr)
    with src.open() as f:
        graph = json.load(f)
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])
    print(f"[curate] loaded {len(nodes):,} nodes, {len(links):,} links", file=sys.stderr)

    node_to_unit: dict[str, str] = {}
    units: dict[str, dict] = {}

    for n in nodes:
        nid = n.get("id")
        src_file = n.get("source_file", "") or ""
        if not nid:
            continue
        clf = classify(nid, src_file)
        if not clf:
            continue
        unit_id, label, typ = clf
        node_to_unit[nid] = unit_id
        if unit_id not in units:
            units[unit_id] = {"id": unit_id, "label": label, "type": typ, "file_count": 0}
        units[unit_id]["file_count"] += 1

    print(f"[curate] {len(units)} units after aggregation", file=sys.stderr)

    edge_weights: dict[tuple[str, str], int] = defaultdict(int)
    for l in links:
        s, t = l.get("source"), l.get("target")
        su = node_to_unit.get(s)
        tu = node_to_unit.get(t)
        if not su or not tu or su == tu:
            continue
        edge_weights[(su, tu)] += 1

    print(f"[curate] {len(edge_weights)} aggregated edges (pre-prune)", file=sys.stderr)

    # Prune isolated nodes (0 edges) unless in cold-read keep-list.
    COLD_READ_KEEP = {
        "app:vectos", "mcp:kanban-mcp",
        "profile:hermes-chief-of-staff",
        "script:meeting-ingest", "script:embeddings-outbox-drainer",
    }
    connected = set()
    for (s, t) in edge_weights:
        connected.add(s)
        connected.add(t)
    before = len(units)
    units = {
        uid: u for uid, u in units.items()
        if uid in connected or uid in COLD_READ_KEEP
    }
    print(f"[curate] pruned {before - len(units)} isolated units, {len(units)} remain", file=sys.stderr)
    by_type: dict[str, int] = defaultdict(int)
    for u in units.values():
        by_type[u["type"]] += 1
    for t, c in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}", file=sys.stderr)

    edges = [
        {"id": f"{s}__{t}", "source": s, "target": t, "weight": w}
        for (s, t), w in edge_weights.items()
        if s in units and t in units
    ]
    print(f"[curate] {len(edges)} edges after prune", file=sys.stderr)

    TYPE_COL = {
        "intake": 0, "profile": 1, "hermes": 2,
        "api": 3, "mcp": 4, "pipeline": 5, "script": 5, "app": 6,
    }
    COL_X = 360
    ROW_Y = 110
    cols: dict[int, list[dict]] = defaultdict(list)
    for u in units.values():
        col = TYPE_COL.get(u["type"], 7)
        cols[col].append(u)
    for col, items in cols.items():
        items.sort(key=lambda u: u["label"].lower())
        for i, u in enumerate(items):
            u["x"] = col * COL_X + 80
            u["y"] = i * ROW_Y + 60

    out_nodes = [
        {
            "id": u["id"],
            "label": u["label"],
            "type": u["type"],
            "file_count": u["file_count"],
            "x": u["x"],
            "y": u["y"],
        }
        for u in units.values()
    ]

    payload = {
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "source": str(src),
        "nodes": out_nodes,
        "edges": edges,
        "stats": {
            "nodes": len(out_nodes),
            "edges": len(edges),
            "by_type": dict(by_type),
        },
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w") as f:
        json.dump(payload, f, indent=2)
    print(f"[curate] wrote {OUT_PATH} ({OUT_PATH.stat().st_size / 1e3:.0f}KB)", file=sys.stderr)
    print(f"[curate] nodes={len(out_nodes)}  edges={len(edges)}", file=sys.stderr)


if __name__ == "__main__":
    main()
