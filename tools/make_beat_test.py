"""Gera músicas sintéticas com batidas de posição conhecida, para medir o BeatMarker.

Uso: python -I tools/make_beat_test.py
Saída em test/: beats_<bpm>.wav (48 kHz, 16 bits, estéreo) e beats_<bpm>.json com o gabarito
{"bpm": ..., "beats": [segundos...]}.
"""
import json
import wave
from pathlib import Path

import numpy as np

SR = 48000
rng = np.random.default_rng(7)


def kick(n=int(0.25 * SR)):
    t = np.arange(n) / SR
    freq = 50 + 90 * np.exp(-t * 30)                 # queda de tom do bumbo
    return np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 12)


def snare(n=int(0.18 * SR)):
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25)
    return 0.6 * body + 0.5 * rng.standard_normal(n) * np.exp(-t * 20)


def hat(n=int(0.05 * SR)):
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0)                # agudo
    return 0.25 * noise * np.exp(-t * 80)


def add(buf, sound, at):
    i = int(round(at * SR))
    j = min(len(buf), i + len(sound))
    if i < len(buf):
        buf[i:j] += sound[: j - i]


def make(bpm, seconds, start, drift=0.0, name=None):
    """drift: variação de tempo (fração do período) para simular música tocada, não quantizada."""
    buf = np.zeros(int(seconds * SR))
    buf += 0.08 * np.sin(2 * np.pi * 110 * np.arange(len(buf)) / SR)  # um baixo contínuo de fundo
    period = 60.0 / bpm
    beats, t, k = [], start, 0
    while t < seconds - 0.3:
        beats.append(round(t, 4))
        if k % 2 == 0:
            add(buf, kick(), t)
        else:
            add(buf, snare(), t)
        add(buf, hat(), t)
        add(buf, hat(), t + period / 2)
        k += 1
        t += period * (1 + drift * np.sin(k / 5.0))
    buf /= np.max(np.abs(buf)) * 1.1
    pcm = (buf * 32767).astype(np.int16)
    stereo = np.repeat(pcm[:, None], 2, axis=1)

    out = Path(__file__).resolve().parent.parent / "test"
    out.mkdir(exist_ok=True)
    name = name or f"beats_{bpm}"
    with wave.open(str(out / f"{name}.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(stereo.tobytes())
    (out / f"{name}.json").write_text(json.dumps({"bpm": bpm, "beats": beats}))
    print(out / f"{name}.wav", len(beats), "batidas")


if __name__ == "__main__":
    make(128, 30, start=0.5)
    make(87, 30, start=1.37, drift=0.01)
