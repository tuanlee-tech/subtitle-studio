#!/usr/bin/env python3
"""Detect spoken language of a media file (first 30s).

Prints JSON to stdout:
{"code": "vi", "name": "vietnamese", "probability": 0.97,
 "alternatives": [{"code": "en", "probability": 0.01}, ...]}

Prefers faster-whisper (VAD-aware). Falls back to openai-whisper.
"""
import argparse
import json
import sys

SAMPLE_RATE = 16000


def detect_faster(media: str, model_name: str, seconds: float):
    from faster_whisper.audio import decode_audio
    from faster_whisper import WhisperModel

    audio = decode_audio(media, sampling_rate=SAMPLE_RATE)
    audio = audio[: int(seconds * SAMPLE_RATE)]
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    code, probability, ranked = model.detect_language(audio)
    return code, probability, ranked


def detect_openai(media: str, model_name: str, seconds: float):
    import whisper

    model = whisper.load_model(model_name)
    audio = whisper.load_audio(media)
    audio = whisper.pad_or_trim(audio, int(seconds * SAMPLE_RATE))
    mel = whisper.log_mel_spectrogram(audio, n_mels=model.dims.n_mels).to(model.device)
    _, probs = whisper.detect_language(model, mel)
    ranked = sorted(probs.items(), key=lambda kv: -kv[1])
    return ranked[0][0], ranked[0][1], ranked


def code_name(code: str) -> str:
    try:
        from faster_whisper.tokenizer import TOKENIZER

        name = TOKENIZER.language_codes.get(code) if hasattr(TOKENIZER, "language_codes") else None
        if name:
            return name
    except Exception:
        pass
    try:
        import whisper.tokenizer as wt

        return wt.LANGUAGES.get(code, code)
    except Exception:
        return code


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("media")
    parser.add_argument("--model", default="medium")
    parser.add_argument("--seconds", type=float, default=30.0)
    args = parser.parse_args()

    try:
        code, probability, ranked = detect_faster(args.media, args.model, args.seconds)
        engine = "faster-whisper"
    except ImportError:
        code, probability, ranked = detect_openai(args.media, args.model, args.seconds)
        engine = "openai-whisper"

    alternatives = [
        {"code": c, "probability": round(float(p), 4)}
        for c, p in ranked
        if c != code
    ][:3]

    print(
        json.dumps(
            {
                "code": code,
                "name": code_name(code),
                "probability": round(float(probability), 4),
                "alternatives": alternatives,
                "engine": engine,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
