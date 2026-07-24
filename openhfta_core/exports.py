import csv
import io
import json
import matplotlib.pyplot as plt
import numpy as np


WEB = {
    "background": "#071521",
    "panel": "#0d1e2a",
    "grid": "#263943",
    "text": "#d5e0e2",
    "muted": "#91a5ad",
    "orange": "#f2a65a",
    "green": "#6bd48b",
    "blue": "#287bb0",
    "flat": "#d93636",
    "aoa": "#d92fc4",
    "rays": {
        "direct": "#287bb0",
        "reflected": "#78b7d9",
        "diffracted": "#174f91",
        "reflected_diffracted": "#f2a65a",
        "double_diffracted": "#102f59",
        "reflected_double_diffracted": "#c58cff",
    },
}
RAY_LABELS = {
    "direct": "Direto",
    "reflected": "Reflexão",
    "diffracted": "Difração",
    "reflected_diffracted": "Reflexão + difração",
    "double_diffracted": "Difração dupla",
    "reflected_double_diffracted": "Reflexão + dupla difração",
}


def result_json(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def result_csv(payload: dict) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["angle_deg", "pattern_db"])
    writer.writerows(zip(payload["angles_deg"], payload["pattern_db"]))
    return output.getvalue().encode("utf-8")


def _safe_float(value, default=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _configuration_text(payload: dict) -> str:
    config = payload.get("configuration", {})
    heights = config.get("antenna_heights_m") or []
    height_text = " / ".join(f"{_safe_float(height):.1f} m" for height in heights) or "n/d"
    polarization = "Vertical (V/TM)" if config.get("polarization") == "vertical" else "Horizontal (H/TE)"
    diffraction = "incluída" if not config.get("diffraction_disable") else "desativada"
    return (
        f"{_safe_float(config.get('frequency_mhz')):.2f} MHz  ·  {polarization}  ·  "
        f"alturas {height_text}  ·  difração {diffraction}"
    )


def _sources_text(payload: dict) -> str:
    sources = payload.get("sources", {})
    profile = sources.get("profile_name") or "perfil carregado"
    prn = sources.get("prn_name") or "compartilhado/padrão"
    return f"PRO: {profile}  ·  PRN: {prn}"


def _style_axis(axis, *, x_label: str, y_label: str, title: str | None = None) -> None:
    axis.set_facecolor(WEB["panel"])
    axis.grid(color=WEB["grid"], alpha=.8, linewidth=.7)
    axis.tick_params(colors=WEB["muted"], labelsize=9)
    for spine in axis.spines.values():
        spine.set_color(WEB["grid"])
    axis.set_xlabel(x_label, color=WEB["muted"], fontsize=10)
    axis.set_ylabel(y_label, color=WEB["muted"], fontsize=10)
    if title:
        axis.set_title(title, loc="left", color=WEB["orange"], fontsize=12, fontweight="bold", pad=12)


def _plot_pattern(axis, payload: dict) -> None:
    angles = np.asarray(payload.get("angles_deg", []), dtype=float)
    pattern = np.asarray(payload.get("pattern_db", []), dtype=float)
    if not len(angles):
        return
    axis.plot(angles, pattern, color=WEB["orange"], linewidth=2.2, label="PRO", zorder=3)
    axis.fill_between(angles, pattern, -10, color=WEB["orange"], alpha=.08)
    flat = payload.get("flat_pattern_db")
    if flat is not None:
        axis.plot(angles, flat, color=WEB["flat"], linewidth=1.7, linestyle="--", label="FLAT.PRO", zorder=2)
    aoa = payload.get("aoa") or {}
    if aoa.get("available") and aoa.get("angles_deg"):
        twin = axis.twinx()
        twin.bar(aoa["angles_deg"], aoa["probabilities_pct"], width=.72, color=WEB["aoa"], alpha=.28, label=f"PRN · {aoa.get('band') or ''}")
        twin.set_ylim(0, 20)
        twin.set_ylabel("Estatística de elevação (%)", color=WEB["muted"], fontsize=10)
        twin.tick_params(colors=WEB["muted"], labelsize=9)
        for spine in twin.spines.values():
            spine.set_color(WEB["grid"])
        handles, labels = axis.get_legend_handles_labels()
        twin_handles, twin_labels = twin.get_legend_handles_labels()
        axis.legend(handles + twin_handles, labels + twin_labels, loc="upper right", facecolor=WEB["panel"], edgecolor=WEB["grid"], labelcolor=WEB["text"], fontsize=9)
    else:
        axis.legend(loc="upper right", facecolor=WEB["panel"], edgecolor=WEB["grid"], labelcolor=WEB["text"], fontsize=9)
    axis.set_xlim(0, 36)
    axis.set_ylim(-10, 20)
    axis.set_xticks(range(0, 37, 5))
    _style_axis(axis, x_label="Elevação (°)", y_label="Ganho (dB)", title="PADRÃO DE ELEVAÇÃO")


def _plot_terrain(axis, payload: dict) -> None:
    profile = payload.get("profile") or {}
    distances = np.asarray(profile.get("distances_m", []), dtype=float)
    heights = np.asarray(profile.get("heights_m", []), dtype=float)
    points = min(len(distances), len(heights), int(profile.get("points", len(distances))))
    if points:
        axis.fill_between(distances[:points], heights[:points], min(heights[:points]), color=WEB["green"], alpha=.12)
        axis.plot(distances[:points], heights[:points], color=WEB["green"], linewidth=1.8, label="TERRENO")
        axis.legend(loc="upper right", facecolor=WEB["panel"], edgecolor=WEB["grid"], labelcolor=WEB["text"], fontsize=9)
    _style_axis(axis, x_label="Distância (m)", y_label="Altitude (m)", title="PERFIL DO TERRENO")


def _plot_rays(axis, payload: dict) -> None:
    profile = payload.get("profile") or {}
    distances = np.asarray(profile.get("distances_m", []), dtype=float)
    heights = np.asarray(profile.get("heights_m", []), dtype=float)
    points = min(len(distances), len(heights), int(profile.get("points", len(distances))))
    if points:
        axis.fill_between(distances[:points] / 1000, heights[:points], min(heights[:points]), color="#c2aea2", alpha=.25)
        axis.plot(distances[:points] / 1000, heights[:points], color="#d5c2b7", linewidth=1.8, label="TERRENO", zorder=4)
        antenna_height = (payload.get("configuration", {}).get("antenna_heights_m") or [0])[0]
        axis.scatter([0], [heights[0] + _safe_float(antenna_height)], color=WEB["orange"], marker="^", s=48, label="Antena", zorder=5)
    trace = payload.get("ray_trace") or {}
    shown = set()
    for path in trace.get("paths", []):
        kind = path.get("kind", "other")
        x = np.asarray(path.get("distances_m", []), dtype=float) / 1000
        y = np.asarray(path.get("heights_m", []), dtype=float)
        if len(x) < 2:
            continue
        label = RAY_LABELS.get(kind, kind)
        axis.plot(x, y, color=WEB["rays"].get(kind, WEB["blue"]), linewidth=.7, alpha=.28, label=label if kind not in shown else "")
        shown.add(kind)
    _style_axis(axis, x_label="Distância (km)", y_label="Altura (m)", title="TRAÇADO DE RAIOS DO NÚCLEO")
    if points:
        axis.set_xlim(0, max(0.5, distances[points - 1] / 1000))
        axis.set_ylim(max(0, min(heights[:points]) - 30), 1000)
    if shown or points:
        axis.legend(loc="upper center", bbox_to_anchor=(.5, -0.16), ncol=3, facecolor=WEB["panel"], edgecolor=WEB["grid"], labelcolor=WEB["text"], fontsize=8)


def _add_metrics(figure, payload: dict) -> None:
    metrics = payload.get("metrics") or {}
    peak = metrics.get("peak") or {}
    beamwidth = metrics.get("beamwidth_3db") or {}
    average = metrics.get("integrated_average_gain") or {}
    values = [
        ("PICO DO PADRÃO", f"{_safe_float(peak.get('value_db')):.2f} dB"),
        ("ÂNGULO DO PICO", f"{_safe_float(peak.get('angle_deg')):.2f}°"),
        ("MÉDIA INTEGRADA", f"{_safe_float(average.get('average_db')):.2f} dB"),
        ("LARGURA −3 dB", "—" if beamwidth.get("width_deg") is None else f"{_safe_float(beamwidth.get('width_deg')):.2f}°"),
    ]
    for index, (label, value) in enumerate(values):
        figure.text(.08 + index * .22, .895, label, color=WEB["muted"], fontsize=8, family="DejaVu Sans")
        figure.text(.08 + index * .22, .87, value, color=WEB["orange"], fontsize=15, fontweight="bold", family="DejaVu Sans")


def result_figure(payload: dict, image_format: str) -> bytes:
    """Render the same information hierarchy shown by the web result panel."""
    figure = plt.figure(figsize=(12, 17), facecolor=WEB["background"])
    figure.text(.08, .968, "OpenHFTA", color=WEB["text"], fontsize=24, fontweight="bold")
    figure.text(.08, .946, "HF TERRAIN ANALYSIS  ·  RELATÓRIO DE ANÁLISE", color=WEB["orange"], fontsize=10, fontweight="bold")
    figure.text(.08, .924, _configuration_text(payload), color=WEB["muted"], fontsize=10)
    figure.text(.08, .907, _sources_text(payload), color=WEB["muted"], fontsize=9)
    _add_metrics(figure, payload)
    pattern_axis = figure.add_axes([.08, .63, .84, .20])
    terrain_axis = figure.add_axes([.08, .39, .84, .17])
    ray_axis = figure.add_axes([.08, .13, .84, .19])
    _plot_pattern(pattern_axis, payload)
    _plot_terrain(terrain_axis, payload)
    _plot_rays(ray_axis, payload)
    limitations = payload.get("limitations") or []
    if limitations:
        figure.text(.08, .035, "LIMITES DO MODELO  ·  " + "  ·  ".join(limitations[:2]), color=WEB["muted"], fontsize=7.5, wrap=True)
    output = io.BytesIO()
    figure.savefig(output, format=image_format, dpi=170, bbox_inches="tight", facecolor=figure.get_facecolor())
    plt.close(figure)
    return output.getvalue()
