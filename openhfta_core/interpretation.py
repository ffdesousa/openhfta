"""Deterministic Portuguese interpretation of calculated pattern metrics."""


def interpret_ray_trace(ray_trace: dict | None, profile: dict | None = None) -> dict[str, str | list[str]]:
    """Read the geometric trace without treating line count as received power."""
    if not ray_trace or not ray_trace.get("available"):
        return {"beginner": "O traçado geométrico de raios não está disponível para esta análise.", "technical": "", "observations": []}

    paths = [path for path in ray_trace.get("paths", []) if len(path.get("distances_m", [])) >= 2]
    counts = ray_trace.get("counts", {})
    labels = {
        "direct": "diretas",
        "reflected": "refletidas",
        "diffracted": "difratadas",
        "reflected_diffracted": "com reflexão e difração",
        "double_diffracted": "com dupla difração",
        "reflected_double_diffracted": "com reflexão e dupla difração",
    }
    total = len(paths)
    count_text = ", ".join(f"{int(counts.get(kind, 0))} {labels[kind]}" for kind in labels if counts.get(kind, 0)) or "nenhuma trajetória válida"
    observations = [f"O núcleo calculou {count_text}; a quantidade de linhas não representa, sozinha, a intensidade recebida."]

    for kind, label in labels.items():
        selected = [path for path in paths if path.get("kind") == kind]
        if not selected:
            continue
        angles = [float(path.get("angle_deg", 0.0)) for path in selected]
        observations.append(f"Trajetórias {label}: ângulos de saída entre {min(angles):.2f}° e {max(angles):.2f}°.")

    terrain_heights = (profile or {}).get("heights_m", [])
    terrain_distances = (profile or {}).get("distances_m", [])
    if terrain_heights and terrain_distances:
        contacts = 0
        for path in paths:
            if path.get("kind") not in ("reflected", "diffracted", "reflected_diffracted", "double_diffracted", "reflected_double_diffracted"):
                continue
            for x, y in zip(path.get("distances_m", []), path.get("heights_m", [])):
                nearest = min(range(len(terrain_distances)), key=lambda index: abs(terrain_distances[index] - x))
                if abs(y - terrain_heights[nearest]) <= 4:
                    contacts += 1
                    break
        if contacts:
            observations.append(f"Foram identificadas {contacts} trajetórias com contato próximo ao terreno, dentro da tolerância de 4 m.")

    steep = [path for path in paths if abs(float(path.get("angle_deg", 0.0))) > 10.0]
    if steep:
        observations.append(f"{len(steep)} trajetórias saem acima de 10°; elas devem ser comparadas com o objetivo do enlace e não tratadas automaticamente como sinais úteis de longa distância.")
    beginner = f"O traçado mostra {total} trajetórias geométricas válidas: {count_text}. " \
               "Ele ajuda a localizar caminhos diretos, reflexões e difrações sobre o relevo, mas não substitui o ganho do padrão nem mede sozinho a potência recebida."
    technical = "Os ângulos informados são ângulos de saída armazenados pelo núcleo; caminhos geométricos podem ter pesos diferentes no padrão final por ganho de antena, fase, reflexão e difração."
    return {"beginner": beginner, "technical": technical, "observations": observations}

def interpret_pattern(metrics: dict, ray_trace: dict | None = None, profile: dict | None = None) -> dict[str, str | list[str]]:
    peak = metrics["peak"]
    null = metrics["lowest_null"]
    beam = metrics["beamwidth_3db"]
    average = metrics["integrated_average_gain"]["average_db"]
    width = beam["width_deg"]
    width_text = "não determinada no intervalo analisado" if width is None else f"{width:.2f}°"
    beginner = (
        f"O maior ganho é de {peak['value_db']:.2f} dB em {peak['angle_deg']:.2f}°. "
        f"A largura aproximada do feixe em -3 dB é {width_text}. "
        f"O ganho médio integrado no intervalo é {average:.2f} dB."
    )
    technical = (
        f"Máximo global: {peak['value_db']:.6f} dB @ {peak['angle_deg']:.2f}°; "
        f"mínimo amostrado: {null['value_db']:.2f} dB @ {null['angle_deg']:.2f}°; "
        f"limiar de meia potência: {beam['threshold_db']:.2f} dB."
    )
    observations = []
    if peak["angle_deg"] <= 10:
        observations.append("O pico está em uma faixa de elevação baixa, normalmente associada a enlaces de maior alcance.")
    elif peak["angle_deg"] <= 20:
        observations.append("O pico está em uma faixa de elevação intermediária.")
    else:
        observations.append("O pico está em uma faixa de elevação alta; compare com o objetivo operacional do enlace.")
    if len(metrics["nulls"]):
        observations.append(f"Foram identificados {len(metrics['nulls'])} nulos locais entre os cinco principais valores reportados.")
    ray_reading = interpret_ray_trace(ray_trace, profile)
    beginner = f"{beginner} {ray_reading['beginner']}"
    technical = f"{technical} {ray_reading['technical']}".strip()
    observations.extend(ray_reading["observations"])
    return {"headline": f"Pico de {peak['value_db']:.2f} dB em {peak['angle_deg']:.2f}°", "beginner": beginner, "technical": technical, "observations": observations}


def interpret_comparison(scenarios: list[dict], comparison: dict) -> dict[str, str | list[str]]:
    """Describe every scenario in a comparison, not only the first pair."""
    if not scenarios:
        return {"headline": "Comparação sem cenários", "beginner": "Não há cenários suficientes para interpretar.", "technical": "", "observations": []}

    peaks = [(scenario["name"], scenario["metrics"]["peak"]) for scenario in scenarios]
    best_name, best_peak = max(peaks, key=lambda item: item[1]["value_db"])
    scenario_text = "; ".join(
        f"{name} atinge pico de {peak['value_db']:.2f} dB em {peak['angle_deg']:.2f}° "
        f"e média integrada de {scenario['metrics']['integrated_average_gain']['average_db']:.2f} dB"
        for scenario, (name, peak) in zip(scenarios, peaks)
    )
    beginner = (
        f"{scenario_text}. {best_name} tem o maior pico ({best_peak['value_db']:.2f} dB). "
        f"A diferença média da primeira comparação é de {comparison['rmse_db']:.2f} dB."
    )
    pairwise = comparison.get("pairwise", [])
    technical = (
        f"Foram analisados {len(scenarios)} cenários e {len(pairwise)} comparações par-a-par; "
        f"RMSE da primeira comparação: {comparison['rmse_db']:.4f} dB; "
        f"maior diferença ponto a ponto nessa comparação: {comparison['max_absolute_delta_db']:.4f} dB."
    )
    observations = [
        f"{name}: pico de {peak['value_db']:.2f} dB em {peak['angle_deg']:.2f}°."
        for name, peak in peaks
    ]
    observations.append(
        "O melhor cenário não deve ser escolhido apenas pelo maior pico: compare também o ângulo do pico, a faixa de elevação desejada, os nulos e o terreno."
    )
    for scenario in scenarios:
        ray_reading = interpret_ray_trace(scenario.get("ray_trace"), scenario.get("profile"))
        ray_observations = ray_reading.get("observations", [])
        if ray_observations:
            observations.append(f"{scenario['name']}: {ray_observations[0]}")
            observations.append(f"{scenario['name']}: {ray_observations[-1]}")
    beginner += " A comparação também considera o tipo e a distribuição geométrica dos trajetos de cada cenário; isso não transforma contagem de linhas em potência recebida."
    names = " × ".join(scenario["name"] for scenario in scenarios)
    return {"headline": f"Comparação: {names}", "beginner": beginner, "technical": technical, "observations": observations}
