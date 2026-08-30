from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
from pathlib import Path

import edge_tts


VOICE = "de-DE-ConradNeural"
RATE = "-6%"

SPELLING_ALPHABET = {
    "a": "Anton",
    "b": "Berta",
    "c": "Cäsar",
    "d": "Dora",
    "e": "Emil",
    "f": "Friedrich",
    "g": "Gustav",
    "h": "Heinrich",
    "i": "Ida",
    "j": "Julius",
    "k": "Kaufmann",
    "l": "Ludwig",
    "m": "Martha",
    "n": "Nordpol",
    "o": "Otto",
    "p": "Paula",
    "q": "Quelle",
    "r": "Richard",
    "s": "Samuel",
    "t": "Theodor",
    "u": "Ulrich",
    "v": "Viktor",
    "w": "Wilhelm",
    "x": "Xanthippe",
    "y": "Ypsilon",
    "z": "Zacharias",
}

TYPE_TEXT = {
    "dlk": "D L K",
    "elw": "E L W",
    "flb": "F L B",
    "gwas": "G W A S",
    "gwrh": "G W R H",
    "gwsan": "G W San",
    "gwl": "G W L",
    "gww": "G W W",
    "hlf": "H L F",
    "itw": "I T W",
    "kdow": "K D O W",
    "klaf": "K L A F",
    "klb": "K L B",
    "kmb": "K M B",
    "kran": "Kran",
    "nef": "N E F",
    "rtw": "R T W",
    "rw": "R W",
    "tlf": "T L F",
    "tmf": "T M F",
    "wlf": "W L F",
}

# Exakt die regulären Fahrzeuge aus 4_LST/AUBMP.cfg. Versteckte Sammel- und
# Aktions-Einheiten gehören nicht zur Fahrzeugansage des Wachmonitors.
AUENBURG_MONITOR_CALLSIGNS = (
    "1_DLK_1", "1_ELW_1", "1_GWAS_1", "1_HLF_1", "1_HLF_2", "1_KDOW_1", "1_KLAF_1", "1_RTW_A",
    "11_HLF_1", "11_TLF_1",
    "2_ELW_1", "2_HLF_1", "2_ITW_R", "2_KRAN_1", "2_NEF_A", "2_RTW_A", "2_RTW_Z", "2_RW_1",
    "2_TMF_1", "2_WLF_1",
    "3_DLK_1", "3_ELW_1", "3_GWW_1", "3_HLF_1", "3_RTW_A", "3_RTW_B", "3_TLF_1", "3_WLF_1",
    "31_GWL_1", "31_HLF_1",
    "4_ELW_1", "4_GWRH_1", "4_GWSAN_1", "4_HLF_1", "4_ITW_A", "4_KMB_1", "4_NEF_A", "4_NEF_K",
    "4_RTW_A", "4_RTW_B", "4_RTW_R", "4_WLF_1",
    "72_NEF_A", "72_RTW_A", "72_RTW_B", "74_NEF_A", "74_RTW_A", "74_RTW_B",
    "Christoph_82", "Christoph_84", "0_KLB_1", "0_FLB_1",
)


def callsign_text(identifier: str) -> str:
    if identifier.startswith("Christoph_"):
        return identifier.replace("_", " ")
    if identifier == "0_KLB_1":
        return "K L B Bad Greifszoll"
    if identifier == "0_FLB_1":
        return "F L B Oberschwaben"
    station, vehicle_type, suffix = identifier.split("_", maxsplit=2)
    spoken_suffix = SPELLING_ALPHABET[suffix.lower()] if suffix.isalpha() else suffix
    return ", ".join((station, TYPE_TEXT[vehicle_type.lower()], spoken_suffix))


def fragments() -> dict[str, str]:
    result = {"intro.mp3": "Einsatz für:"}
    result.update({
        f"callsigns/{identifier.lower()}.mp3": callsign_text(identifier)
        for identifier in AUENBURG_MONITOR_CALLSIGNS
    })
    return result


async def generate_one(
    output: Path,
    relative_path: str,
    text: str,
    semaphore: asyncio.Semaphore,
    force: bool,
) -> None:
    target = output / relative_path
    if not force and target.is_file() and target.stat().st_size > 0:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    async with semaphore:
        await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(target))
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            return
        trimmed = target.with_suffix(".trimmed.mp3")
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-v",
                "error",
                "-i",
                str(target),
                "-af",
                "silenceremove=start_periods=1:start_duration=0.03:start_threshold=-45dB,"
                "areverse,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-45dB:"
                "start_silence=0.5,areverse",
                str(trimmed),
            ],
            check=True,
        )
        trimmed.replace(target)


async def generate(output: Path, force: bool = False) -> None:
    items = fragments()
    semaphore = asyncio.Semaphore(6)
    await asyncio.gather(
        *(generate_one(output, relative_path, text, semaphore, force) for relative_path, text in items.items())
    )
    expected_files = {output / relative_path for relative_path in items}
    for generated_file in output.rglob("*.mp3"):
        if generated_file not in expected_files:
            generated_file.unlink()
    for directory in sorted((path for path in output.rglob("*") if path.is_dir()), reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass
    (output / "manifest.json").write_text(
        json.dumps(
            {
                "voice": VOICE,
                "rate": RATE,
                "spelling_alphabet": SPELLING_ALPHABET,
                "source": "AUBMP/4_LST/AUBMP.cfg",
                "callsigns": list(AUENBURG_MONITOR_CALLSIGNS),
                "pause_seconds": 0.5,
                "files": len(items),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("frontend/public/sounds/monitor/tts-conrad"),
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    asyncio.run(generate(args.output, args.force))


if __name__ == "__main__":
    main()
