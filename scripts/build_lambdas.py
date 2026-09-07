"""Empacota as Lambdas: build/core.zip (processador e notificador) e build/api.zip (FastAPI).

As dependências são instaladas como wheels manylinux para x86_64 e Python 3.12, que é o runtime
do Lambda. Sem isso, pacotes compilados (pydantic-core) instalados no Windows não carregam lá.

  python scripts/build_lambdas.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
SRC = ROOT / "src" / "energia"

TARGETS = {
    "core": ROOT / "requirements" / "core.txt",
    "api": ROOT / "requirements" / "api.txt",
}


def build(name: str, requirements: Path) -> Path:
    stage = BUILD / name
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-r",
            str(requirements),
            "--target",
            str(stage),
            "--platform",
            "manylinux2014_x86_64",
            "--implementation",
            "cp",
            "--python-version",
            "3.12",
            "--only-binary=:all:",
            "--upgrade",
            "--quiet",
        ],
        check=True,
    )
    shutil.copytree(SRC, stage / "energia", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for junk in stage.glob("**/__pycache__"):
        shutil.rmtree(junk, ignore_errors=True)

    zip_path = BUILD / f"{name}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                info = zipfile.ZipInfo(str(path.relative_to(stage)).replace("\\", "/"))
                info.date_time = (2020, 1, 1, 0, 0, 0)  # zip determinístico: o hash só muda se o conteúdo mudar
                info.external_attr = 0o644 << 16
                zf.writestr(info, path.read_bytes())
    size_mb = zip_path.stat().st_size / 1e6
    print(f"{zip_path.relative_to(ROOT)}  {size_mb:.1f} MB")
    return zip_path


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    for name, req in TARGETS.items():
        build(name, req)


if __name__ == "__main__":
    main()
