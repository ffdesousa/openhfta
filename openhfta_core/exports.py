import csv
import io
import json
from pathlib import Path
import matplotlib.pyplot as plt

def result_json(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")

def result_csv(payload: dict) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["angle_deg", "pattern_db"])
    writer.writerows(zip(payload["angles_deg"], payload["pattern_db"]))
    return output.getvalue().encode("utf-8")

def result_figure(payload: dict, image_format: str) -> bytes:
    figure, axis = plt.subplots(figsize=(10, 6))
    axis.plot(payload["angles_deg"], payload["pattern_db"], color="#d9873d", linewidth=2)
    axis.set(xlabel="Elevation angle (degrees)", ylabel="Gain (dB)", title="OpenHFTA elevation pattern")
    axis.grid(alpha=0.3)
    output = io.BytesIO()
    figure.savefig(output, format=image_format, dpi=150, bbox_inches="tight")
    plt.close(figure)
    return output.getvalue()
