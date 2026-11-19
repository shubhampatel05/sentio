"""
emotion_engine.py
------------------
The actual voice-emotion recognition pipeline.

Two layers, by design:

1. A deterministic, research-grounded DSP pipeline (default, always available):
   - extract_features(): classical acoustic/prosodic features via librosa
     (pitch/F0, energy, spectral shape, tempo, jitter, speech rate).
   - score_emotions(): maps those features onto three affective dimensions
     (arousal, valence, tension) using well-documented correlates from
     speech-emotion research (Scherer 2003; Banse & Scherer 1996), then
     scores 8 emotions by distance to reference anchor points in that
     3D space. This is explainable and reacts to real vocal characteristics,
     but it is a heuristic, not a trained classifier.

2. An optional learned model (model.joblib), trained by train_model.py on a
   labeled corpus (e.g. RAVDESS, CREMA-D, TESS, SAVEE) using the exact same
   feature extractor. If model.joblib is present, it's used automatically
   in place of the heuristic scorer. This is the honest upgrade path from
   "demo" to "production accuracy" without changing anything else.
"""

import io
import os
import warnings

import numpy as np
import librosa
import soundfile as sf

warnings.filterwarnings("ignore")

EMOTIONS = ["happy", "calm", "sad", "angry", "fearful", "surprised", "disgust", "neutral"]

# Tones follow the site's "Obsidian & Ember" palette (see static/css/style.css).
# The brand accent (ember orange) is never used for data; emotions use three
# semantic hues so a colour always means the same thing:
#   mint (#4FD6A3) -> neutral / positive emotions
#   sky  (#6FA8FF) -> elevated or low-energy emotions
#   rose (#FF5C7A) -> tense / negative emotions
EMOTION_META = {
    "happy":     {"color": "#4FD6A3", "label": "Happy"},
    "calm":      {"color": "#4FD6A3", "label": "Calm"},
    "neutral":   {"color": "#4FD6A3", "label": "Neutral"},
    "surprised": {"color": "#6FA8FF", "label": "Surprised"},
    "sad":       {"color": "#6FA8FF", "label": "Sad"},
    "angry":     {"color": "#FF5C7A", "label": "Angry"},
    "fearful":   {"color": "#FF5C7A", "label": "Fearful"},
    "disgust":   {"color": "#FF5C7A", "label": "Disgust"},
}

_MODEL = None
_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.joblib")


def _load_model():
    """Lazily load a trained model.joblib if one has been produced by train_model.py."""
    global _MODEL
    if _MODEL is None and os.path.exists(_MODEL_PATH):
        import joblib
        _MODEL = joblib.load(_MODEL_PATH)
    return _MODEL


def _clamp01(x):
    return max(0.0, min(1.0, float(x)))


def _minmax(value, lo, hi):
    if hi == lo:
        return 0.5
    return _clamp01((value - lo) / (hi - lo))


def load_audio(audio_bytes, target_sr=22050):
    """Decode audio bytes (WAV/FLAC/OGG) into a mono float32 signal at target_sr."""
    with io.BytesIO(audio_bytes) as bio:
        y, sr = sf.read(bio, dtype="float32", always_2d=False)

    if y.ndim > 1:
        y = np.mean(y, axis=1)

    if sr != target_sr:
        y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
        sr = target_sr

    y, _ = librosa.effects.trim(y, top_db=25)

    if len(y) < sr * 0.6:
        raise ValueError("That clip is too short to read. Speak for at least a second or two.")

    return y, sr


def extract_features(y, sr):
    """Classical prosodic + spectral feature set used by both the heuristic
    scorer and (if present) the trained model."""
    features = {}

    rms = librosa.feature.rms(y=y)[0]
    features["energy_mean"] = float(np.mean(rms))
    features["energy_std"] = float(np.std(rms))

    zcr = librosa.feature.zero_crossing_rate(y)[0]
    features["zcr_mean"] = float(np.mean(zcr))

    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    features["centroid_mean"] = float(np.mean(centroid))

    bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
    features["bandwidth_mean"] = float(np.mean(bandwidth))

    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr)[0]
    features["rolloff_mean"] = float(np.mean(rolloff))

    contrast = librosa.feature.spectral_contrast(y=y, sr=sr)
    features["contrast_mean"] = float(np.mean(contrast))

    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    for i in range(13):
        features[f"mfcc{i + 1}_mean"] = float(np.mean(mfcc[i]))

    try:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        features["tempo"] = float(tempo) if np.isscalar(tempo) else float(tempo[0])
    except Exception:
        features["tempo"] = 110.0

    try:
        f0, _, _ = librosa.pyin(
            y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"), sr=sr
        )
        f0_voiced = f0[~np.isnan(f0)]
        if len(f0_voiced) > 2:
            features["pitch_mean"] = float(np.mean(f0_voiced))
            features["pitch_std"] = float(np.std(f0_voiced))
            features["pitch_range"] = float(np.max(f0_voiced) - np.min(f0_voiced))
            features["jitter"] = float(
                np.mean(np.abs(np.diff(f0_voiced))) / (np.mean(f0_voiced) + 1e-6)
            )
        else:
            raise ValueError("no voiced frames")
    except Exception:
        features["pitch_mean"] = 165.0
        features["pitch_std"] = 12.0
        features["pitch_range"] = 25.0
        features["jitter"] = 0.02

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    duration = librosa.get_duration(y=y, sr=sr)
    features["speech_rate"] = float(len(onsets) / max(duration, 0.1))
    features["duration"] = float(duration)

    return features


def score_emotions(features):
    """Heuristic fallback: map features -> (arousal, valence, tension) -> emotion probabilities."""
    arousal = (
        0.30 * _minmax(features["energy_mean"], 0.005, 0.25)
        + 0.20 * _minmax(features["tempo"], 60, 180)
        + 0.25 * _minmax(features["pitch_std"], 5, 80)
        + 0.15 * _minmax(features["centroid_mean"], 800, 4000)
        + 0.10 * _minmax(features["speech_rate"], 1.0, 6.0)
    )

    brightness = _minmax(features["centroid_mean"], 800, 4000)
    pitch_level = _minmax(features["pitch_mean"], 90, 300)
    jitter_penalty = 1 - _minmax(features["jitter"], 0.01, 0.12)
    mfcc1_norm = 1 - _minmax(features["mfcc1_mean"], -500, -50)
    valence = _clamp01(
        0.35 * pitch_level + 0.25 * brightness + 0.25 * jitter_penalty + 0.15 * mfcc1_norm
    )

    tension = _clamp01(
        0.5 * _minmax(features["contrast_mean"], 15, 35)
        + 0.3 * _minmax(features["zcr_mean"], 0.02, 0.18)
        + 0.2 * _minmax(features["pitch_range"], 20, 250)
    )

    # Reference anchor points (arousal, valence, tension) per emotion.
    anchors = {
        "happy":     (0.75, 0.80, 0.35),
        "surprised": (0.85, 0.60, 0.55),
        "angry":     (0.80, 0.25, 0.80),
        "fearful":   (0.70, 0.20, 0.75),
        "sad":       (0.20, 0.20, 0.25),
        "disgust":   (0.35, 0.25, 0.55),
        "calm":      (0.20, 0.72, 0.15),
        "neutral":   (0.45, 0.50, 0.35),
    }

    point = np.array([arousal, valence, tension])
    raw = {}
    for emo, coords in anchors.items():
        dist = np.linalg.norm(point - np.array(coords))
        raw[emo] = np.exp(-3.2 * dist)

    total = sum(raw.values())
    probs = {emo: round(v / total, 4) for emo, v in raw.items()}

    dims = {
        "arousal": round(float(arousal), 3),
        "valence": round(float(valence), 3),
        "tension": round(float(tension), 3),
    }
    return probs, dims


def _predict_with_model(model, features):
    names = model["feature_names"]
    vec = np.array([[features.get(n, 0.0) for n in names]])
    pipeline = model["pipeline"]
    proba = pipeline.predict_proba(vec)[0]
    classes = pipeline.classes_
    probs = {c: round(float(p), 4) for c, p in zip(classes, proba)}
    for e in EMOTIONS:
        probs.setdefault(e, 0.0)
    return probs


def analyze_emotion(audio_bytes):
    y, sr = load_audio(audio_bytes)
    features = extract_features(y, sr)

    model = _load_model()
    source = "heuristic"
    dims = None
    if model is not None:
        try:
            probs = _predict_with_model(model, features)
            source = "trained_model"
        except Exception:
            probs, dims = score_emotions(features)
    else:
        probs, dims = score_emotions(features)

    dominant = max(probs, key=probs.get)
    # Peak envelope (max |amplitude| per block) so the UI can draw a clean
    # waveform without shipping the raw samples.
    n_bars = 128
    block = max(1, len(y) // n_bars)
    waveform_preview = [
        float(np.max(np.abs(y[i * block:(i + 1) * block]))) for i in range(n_bars)
    ]

    return {
        "source": source,
        "dominant_emotion": dominant,
        "emotion_meta": EMOTION_META[dominant],
        "probabilities": probs,
        "dimensions": dims,
        "duration": round(float(len(y) / sr), 2),
        "raw_features": {
            "pitch_mean_hz": round(features["pitch_mean"], 1),
            "pitch_variability_hz": round(features["pitch_std"], 1),
            "energy": round(features["energy_mean"], 4),
            "tempo_bpm": round(features["tempo"], 1),
            "speech_rate_ops": round(features["speech_rate"], 2),
            "brightness_hz": round(features["centroid_mean"], 1),
        },
        "waveform_preview": [round(float(v), 4) for v in waveform_preview],
        "emotion_colors": {k: v["color"] for k, v in EMOTION_META.items()},
        "emotion_labels": {k: v["label"] for k, v in EMOTION_META.items()},
    }
