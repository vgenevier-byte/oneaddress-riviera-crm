"""Open/render the five synthetic native-parity decks using bundled LibreOffice.

Usage: <bundled-python> tests/izord/presentation-render.py ARTIFACT_DIRECTORY
       --tools-dir <bundled-dependencies>/bin/override
Requires Pillow and existing presentation-parity-results.json (no browser/Auth).
"""
import argparse
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageChops

parser = argparse.ArgumentParser()
parser.add_argument("artifacts", type=Path)
parser.add_argument("--tools-dir", type=Path, required=True)
args = parser.parse_args()
evidence = json.loads((args.artifacts / "presentation-parity-results.json").read_text())
assert evidence["sourceSHA256"] == "8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1"
assert "failure" not in evidence
originals = Path(evidence["privateOriginalPackages"])
cases = [("blank-two", 2), ("seasonal-two", 2), ("seasonal-three", 3), ("annual-three", 3), ("compare-three", 3)]
assert all(any(check["name"] == name and check["status"] == "pass" for check in evidence["checks"]) for name, _ in cases)
output = args.artifacts / "rendered"
output.mkdir(exist_ok=True)
files = []
for name, _ in cases:
    files += [originals / (name + "-original.pptx"), args.artifacts / (name + "-native.pptx")]
assert all(file.is_file() for file in files)
renderer = str(args.tools_dir / "soffice")
version = subprocess.run([renderer, "--version"], capture_output=True, text=True, check=True).stdout.strip()
result = subprocess.run([renderer, "--headless", "--convert-to", "pdf", "--outdir", str(output), *map(str, files)], capture_output=True, text=True)
(output / "libreoffice-reproducible.log").write_text(result.stdout + result.stderr)
assert result.returncode == 0, "LibreOffice failed; read its retained log."
rows = []
for name, count in cases:
    for kind in ["original", "native"]:
        pdf = output / (name + "-" + kind + ".pdf")
        assert pdf.is_file()
        subprocess.run([str(args.tools_dir / "pdftoppm"), "-png", "-r", "96", str(pdf), str(output / (name + "-" + kind))], capture_output=True, text=True, check=True)
        assert len(list(output.glob(name + "-" + kind + "-*.png"))) == count
    for page in range(1, count + 1):
        a = Image.open(output / f"{name}-original-{page}.png").convert("RGB")
        b = Image.open(output / f"{name}-native-{page}.png").convert("RGB")
        assert a.size == b.size
        bounds = ImageChops.difference(a, b).getbbox()
        rows.append({"case": name, "slide": page, "width": a.width, "height": a.height, "pixelIdentical": bounds is None, "differenceBounds": bounds})
(output / "pixel-parity.json").write_text(json.dumps({"renderer": version, "rasterizer": "pdftoppm 96 DPI", "pages": rows}, indent=2))
assert all(row["pixelIdentical"] for row in rows)
print("13/13 pages identical across five original/native decks; visual inspection remains required.")
