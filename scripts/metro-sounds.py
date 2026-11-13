#!/usr/bin/env python3
"""
Gera os sons do metrónomo e da contagem (public/sounds/metro/*.wav) e acerta a voz (public/sounds/count/*.wav).

Uso:  python3 scripts/metro-sounds.py           (só precisa de numpy)

- Hi-hat fechado: seis ondas quadradas com frequências inarmónicas (o "metal" das baterias eletrónicas
  clássicas), filtradas para cima de 7 kHz, com ruído e o estalo da baqueta. O tempo forte é um pouco
  mais aberto e mais forte.
- Woodblock: síntese modal (três ressonâncias da madeira, cada uma com o seu decaimento) excitada por
  um golpe curto. Como um woodblock de dois tons: o tempo forte é o bloco agudo, os outros o grave.
- Os dois levam uma sala muito curta (primeiras reflexões), para não soarem "secos" como um sintetizador.
- Voz (gravações já existentes, 1 a 12): corta o silêncio antes da palavra, iguala o volume de todas as
  palavras, comprime um pouco e termina com uma descida suave.
"""
import io
import math
import os
import subprocess
import wave

import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'sounds')
SR = 44100
rng = np.random.default_rng(7)  # fixo: os ficheiros saem sempre iguais
# Commit com as gravações originais da voz (Kokoro-82M), antes deste processamento
VOICE_ORIGINAL = '0151283'


# ---------- utilitários ----------
def biquad(x, kind, f0, q=0.707, sr=SR, gain_db=0.0):
    """Filtro biquad (RBJ audio EQ cookbook)."""
    w0 = 2 * math.pi * f0 / sr
    c, s = math.cos(w0), math.sin(w0)
    alpha = s / (2 * q)
    a_lin = 10 ** (gain_db / 40)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]; a = [1 + alpha, -2 * c, 1 - alpha]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]; a = [1 + alpha, -2 * c, 1 - alpha]
    elif kind == 'bp':
        b = [alpha, 0, -alpha]; a = [1 + alpha, -2 * c, 1 - alpha]
    elif kind == 'peak':
        b = [1 + alpha * a_lin, -2 * c, 1 - alpha * a_lin]; a = [1 + alpha / a_lin, -2 * c, 1 - alpha / a_lin]
    elif kind == 'highshelf':
        sq = 2 * math.sqrt(a_lin) * alpha
        b = [a_lin * ((a_lin + 1) + (a_lin - 1) * c + sq), -2 * a_lin * ((a_lin - 1) + (a_lin + 1) * c), a_lin * ((a_lin + 1) + (a_lin - 1) * c - sq)]
        a = [(a_lin + 1) - (a_lin - 1) * c + sq, 2 * ((a_lin - 1) - (a_lin + 1) * c), (a_lin + 1) - (a_lin - 1) * c - sq]
    else:
        raise ValueError(kind)
    b = [v / a[0] for v in b]; a = [v / a[0] for v in a]
    y = np.zeros_like(x); x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def room(x, sr=SR):
    """Sala muito curta: algumas reflexões discretas, abafadas, a -16…-26 dB."""
    y = x.copy()
    for ms, db in ((6.3, -16), (11.7, -19), (17.9, -22), (26.1, -26)):
        d = int(sr * ms / 1000)
        refl = np.zeros_like(x); refl[d:] = x[:-d] * 10 ** (db / 20)
        y += biquad(refl, 'lp', 6000)
    return y


def env_exp(n, attack_s, tau_s, sr=SR):
    t = np.arange(n) / sr
    a = np.clip(t / max(attack_s, 1e-6), 0, 1)
    return a * np.exp(-np.maximum(t - attack_s, 0) / tau_s)


def fade_out(x, ms, sr=SR):
    n = min(len(x), int(sr * ms / 1000))
    x = x.copy(); x[-n:] *= np.linspace(1, 0, n) ** 2
    return x


def trim_tail(x, thresh_db=-60):
    """Corta o fim quando já não se ouve nada (mais 5 ms)."""
    thr = 10 ** (thresh_db / 20) * np.abs(x).max()
    idx = np.nonzero(np.abs(x) > thr)[0]
    end = min(len(x), (idx[-1] if len(idx) else len(x)) + int(SR * 0.005))
    return x[:end]


def save(path, x, sr=SR):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(data.tobytes())


def peak_norm(x, db):
    return x / np.abs(x).max() * 10 ** (db / 20)


# ---------- hi-hat ----------
def hihat(accent):
    dur = 0.32 if accent else 0.2
    n = int(SR * dur); t = np.arange(n) / SR
    # "Metal": 6 ondas quadradas inarmónicas (as da bateria eletrónica clássica), com uma pequena desafinação
    freqs = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 1.47
    metal = sum(np.sign(np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi))) for f in freqs) / 6
    noise = rng.uniform(-1, 1, n)
    body = 0.62 * metal + 0.38 * noise
    body = biquad(body, 'hp', 7000, 0.9)
    body = biquad(body, 'bp', 10500, 0.6) * 0.8 + body * 0.35
    body = biquad(body, 'highshelf', 12000, gain_db=-3)
    # Fechado: decai depressa; o forte fica um pouco mais aberto
    tau = 0.034 if accent else 0.019
    body *= env_exp(n, 0.0004, tau)
    # Estalo da baqueta: 1,5 ms de ruído entre 3 e 5 kHz
    stick = biquad(rng.uniform(-1, 1, n), 'bp', 4200, 1.4) * env_exp(n, 0.0002, 0.0015) * 0.9
    x = room(body + stick)
    return fade_out(trim_tail(peak_norm(x, -1.0 if accent else -4.5)), 6)


# ---------- woodblock ----------
def woodblock(accent):
    dur = 0.25
    n = int(SR * dur); t = np.arange(n) / SR
    f0 = 1320.0 if accent else 940.0
    # Ressonâncias de um bloco de madeira oco (razões inarmónicas), cada uma com o seu decaimento
    modes = ((1.0, 1.0, 0.060), (2.71, 0.34, 0.022), (4.13, 0.16, 0.011), (5.9, 0.07, 0.006))
    x = np.zeros(n)
    for ratio, amp, tau in modes:
        # O tom cai ~1,5 % logo após o golpe (a madeira "assenta"), como num bloco real
        glide = 1 + 0.015 * np.exp(-t / 0.008)
        phase = 2 * np.pi * np.cumsum(f0 * ratio * glide) / SR
        x += amp * np.sin(phase + rng.uniform(0, 2 * np.pi)) * env_exp(n, 0.0005, tau)
    # O golpe da baqueta: ruído muito curto, filtrado
    hit = biquad(rng.uniform(-1, 1, n), 'bp', 2800 if accent else 2200, 0.9) * env_exp(n, 0.0001, 0.0018) * 0.55
    # Corpo: realça um pouco as médias e tira o grave que não existe num woodblock
    x = biquad(x + hit, 'hp', 350, 0.7)
    x = biquad(x, 'peak', f0 * 1.05, 1.2, gain_db=2.5)
    x = room(x)
    return fade_out(trim_tail(peak_norm(x, -1.0 if accent else -6.0)), 6)


# ---------- voz ----------
def read_wav(path):
    with wave.open(path) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float) / 32768
    return x, sr


def compress(x, sr, thresh_db=-18, ratio=3.0, attack=0.002, release=0.06):
    """Compressor simples (detetor de pico com ataque/relaxamento)."""
    thr = 10 ** (thresh_db / 20)
    ga, gr = math.exp(-1 / (sr * attack)), math.exp(-1 / (sr * release))
    env = 0.0; out = np.empty_like(x)
    for i, v in enumerate(x):
        a = abs(v)
        env = ga * env + (1 - ga) * a if a > env else gr * env + (1 - gr) * a
        g = 1.0 if env <= thr else (thr * (env / thr) ** (1 / ratio)) / env
        out[i] = v * g
    return out


def voice(path):
    x, sr = read_wav(path)
    # Começa a palavra logo no tempo: corta o silêncio antes dela (fica 2 ms de margem)
    envl = np.abs(x); start = max(0, int(np.argmax(envl > 0.04 * envl.max())) - int(sr * 0.002))
    x = x[start:]
    x = biquad(x, 'hp', 90, 0.7, sr)                       # tira o grave que só "embrulha"
    x = biquad(x, 'peak', 3000, 1.0, sr, gain_db=2.0)       # presença: percebe-se melhor por cima da música
    x = compress(x, sr)
    # Iguala o volume: todas as palavras com a mesma energia (RMS dos primeiros 250 ms, onde está a palavra)
    head = x[: int(sr * 0.25)]
    x = x * (0.2 / max(1e-6, float(np.sqrt((head ** 2).mean()))))
    x = x / max(1.0, np.abs(x).max() / 0.95)
    return fade_out(trim_tail(x, -55), 12), sr


if __name__ == '__main__':
    out = os.path.join(ROOT, 'metro')
    for acc in (True, False):
        tag = 'accent' if acc else 'normal'
        save(os.path.join(out, f'hihat-{tag}.wav'), hihat(acc))
        save(os.path.join(out, f'wood-{tag}.wav'), woodblock(acc))
    # A voz parte sempre das gravações originais, lidas do histórico do git (assim o script pode
    # voltar a correr sem processar duas vezes a mesma gravação)
    cdir = os.path.join(ROOT, 'count')
    for g in 'fm':
        for i in range(1, 13):
            name = f'{g}{i}.wav'
            raw = subprocess.run(['git', 'show', f'{VOICE_ORIGINAL}:public/sounds/count/{name}'], check=True, capture_output=True).stdout
            x, sr = voice(io.BytesIO(raw))
            save(os.path.join(cdir, name), x, sr)
    print('ok')
