#!/usr/bin/env python3
"""Transcribe media and emit word-level JSON.

Output: {"language": ..., "text": ..., "segments": [
  {"start": .., "end": .., "text": .., "words": [{word, start, end, probability}]}
]}

Two modes:

* single pass — `--model` is a CTranslate2 directory or a plain whisper name
  (medium, large-v3, ...). faster-whisper does everything, VAD included.

* two pass — `--model` is a Hugging Face repo of a Vietnamese fine-tune.
  Those models (PhoASR) write much cleaner Vietnamese — correct spelling,
  punctuation, capitalisation — but they were trained without timestamp
  supervision, so asking them for timestamps collapses the output to a single
  token. So we ask them for *text only* and get word timings from a second
  model (`--timing-model`), then align the two token streams.

VAD matters: plain whisper regularly hallucinates one canned sentence
("Hãy subscribe cho kênh ...") covering the whole video when there is
background music. VAD + condition_on_previous_text=False fixes that.
"""
import argparse
import json
import os
import re
import sys
import unicodedata

VAD_PARAMETERS = {
    "threshold": 0.5,
    "min_silence_duration_ms": 300,
    "speech_pad_ms": 100,
}

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")

WHISPER_NAME = re.compile(r"^(tiny|base|small|medium|large-v2|large-v3|large-v3-turbo|turbo)(\.en)?$")

SENTENCE_END = re.compile(r"[.!?…][\"'”’)\]]*$")


def report(phase: str) -> None:
    """Machine-readable progress marker consumed by the API server."""
    print(f"##PROG## {json.dumps({'phase': phase})}", flush=True)


def detect_language(media: str, model_ref: str, default: str = "vi"):
    """Language detection reuses the timing model so nothing extra is downloaded."""
    try:
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio

        path = model_ref if (os.path.isdir(model_ref) or looks_like_whisper_name(model_ref)) else ensure_ct2(model_ref)
        model = WhisperModel(path, device="cpu", compute_type="int8")
        audio = decode_audio(media, sampling_rate=16000)[: 30 * 16000]
        result = model.detect_language(audio)
        if isinstance(result, (list, tuple)) and len(result) == 2 and isinstance(result[0], str):
            code, probability = result
        else:
            code, probability = max(result, key=lambda item: item[1])
        print(f"detected language: {code} ({probability:.2f})", file=sys.stderr, flush=True)
        return code
    except Exception as exc:  # noqa: BLE001 - detection must never block the pipeline
        print(f"language detection failed ({exc}); falling back to {default}", file=sys.stderr, flush=True)
        return default


# --------------------------------------------------------------------------- #
# model resolution
# --------------------------------------------------------------------------- #

def slugify(repo_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "-", repo_id).strip("-")


def ensure_ct2(repo_id: str) -> str:
    """Convert a HF transformers whisper repo to a local CTranslate2 directory."""
    out_dir = os.path.join(MODELS_DIR, slugify(repo_id))
    if os.path.isfile(os.path.join(out_dir, "model.bin")):
        return out_dir
    os.makedirs(MODELS_DIR, exist_ok=True)
    print(f"converting {repo_id} -> {out_dir} (one time)...", file=sys.stderr, flush=True)
    from ctranslate2.converters.transformers import TransformersConverter

    converter = TransformersConverter(
        repo_id, copy_files=["tokenizer.json", "preprocessor_config.json"]
    )
    converter.convert(out_dir, quantization="int8")
    return out_dir


def looks_like_whisper_name(model: str) -> bool:
    return bool(WHISPER_NAME.match(model))


def looks_like_hf_repo(model: str) -> bool:
    return "/" in model and not os.path.isdir(model)


# --------------------------------------------------------------------------- #
# single pass
# --------------------------------------------------------------------------- #

def transcribe_ct2(model_path, args):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_path, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        args.media,
        language=args.language,
        task=args.task,
        vad_filter=True,
        vad_parameters=VAD_PARAMETERS,
        condition_on_previous_text=False,
        beam_size=args.beam_size,
        word_timestamps=True,
        initial_prompt=args.prompt or None,
    )
    out_segments, text_parts = [], []
    for seg in segments:
        out_segments.append(
            {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text,
                "no_speech_prob": float(getattr(seg, "no_speech_prob", 0.0) or 0.0),
                "words": [
                    {
                        "word": w.word,
                        "start": float(w.start),
                        "end": float(w.end),
                        "probability": float(getattr(w, "probability", 0.0) or 0.0),
                    }
                    for w in (seg.words or [])
                ],
            }
        )
        text_parts.append(seg.text)
    return info.language, "".join(text_parts).strip(), out_segments


# --------------------------------------------------------------------------- #
# two pass
# --------------------------------------------------------------------------- #

def timing_pass(model_ref, args):
    """Word timings from a model that *does* support timestamps."""
    if os.path.isdir(model_ref) or looks_like_whisper_name(model_ref) or model_ref.startswith("models/"):
        path = model_ref
    else:
        path = ensure_ct2(model_ref)
    return transcribe_ct2(path, args)


def text_pass(repo_id, args):
    """Clean Vietnamese text (no timestamps) from a VN fine-tuned whisper."""
    import torch
    from transformers import pipeline

    device = 0 if torch.cuda.is_available() else -1
    asr = pipeline(
        "automatic-speech-recognition",
        model=repo_id,
        device=device,
        chunk_length_s=30,
        ignore_warning=True,
    )
    generate_kwargs = {"task": args.task}
    if args.language:
        generate_kwargs["language"] = args.language
    if args.prompt:
        generate_kwargs["initial_prompt"] = args.prompt
    out = asr(args.media, generate_kwargs=generate_kwargs)
    return (out.get("text") or "").strip()


def normalize(token: str) -> str:
    """Accent- and case-insensitive key used for aligning two transcripts."""
    token = token.lower()
    token = "".join(c for c in unicodedata.normalize("NFD", token) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^\w0-9]+", "", token, flags=re.UNICODE)


def align_words(src_words, dst_text):
    """Map `dst_text` tokens onto the timings of `src_words`.

    src_words: [{word, start, end, probability}] from the timing model
    dst_text : text from the text model

    Returns [{word, start, end, probability}] for the *dst* tokens, plus the
    match ratio (how much of the destination text was anchored to real
    timings).
    """
    from difflib import SequenceMatcher

    src = []
    for w in src_words:
        toks = [t for t in re.split(r"(\s+)", w["word"]) if t.strip()]
        # split multi-token word entries proportionally by character count
        chars = sum(len(t.strip()) for t in toks) or 1
        cursor = w["start"]
        span = w["end"] - w["start"]
        for t in toks:
            piece = t.strip()
            if not piece:
                continue
            share = span * (len(piece) / chars)
            src.append(
                {
                    "norm": normalize(piece),
                    "start": cursor,
                    "end": min(cursor + share, w["end"]),
                    "probability": w.get("probability", 0.0),
                }
            )
            cursor += share

    dst_tokens = [t for t in dst_text.split() if t.strip()]
    dst_norm = [normalize(t) for t in dst_tokens]
    src_norm = [s["norm"] for s in src]

    sm = SequenceMatcher(None, src_norm, dst_norm, autojunk=False)
    matched = sum(b.size for b in sm.get_matching_blocks())
    ratio = (2.0 * matched) / max(1, len(src_norm) + len(dst_norm))

    out = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(j2 - j1):
                s = src[i1 + k]
                out.append(
                    {
                        "word": dst_tokens[j1 + k],
                        "start": s["start"],
                        "end": s["end"],
                        "probability": s["probability"],
                    }
                )
        elif tag in ("replace", "insert"):
            # Anchor a replaced/inserted run to the timing span it covers.
            if i1 < len(src):
                t0 = src[i1]["start"]
            elif src:
                t0 = src[-1]["end"]
            else:
                t0 = 0.0
            if i2 > 0 and i2 <= len(src):
                t1 = src[i2 - 1]["end"]
            else:
                t1 = t0
            if t1 <= t0:
                t1 = t0 + 0.02 * (j2 - j1)
            step = (t1 - t0) / max(1, j2 - j1)
            for k in range(j2 - j1):
                out.append(
                    {
                        "word": dst_tokens[j1 + k],
                        "start": t0 + k * step,
                        "end": t0 + (k + 1) * step,
                        "probability": 0.0,
                    }
                )
        # "delete": drop timing-only words the text model rejected
    return out, ratio


def build_segments(words, max_gap=0.6, max_words=14, max_span=8.0):
    """Group aligned words into segments, cutting on sentence punctuation."""
    segments, cur = [], []

    def flush():
        if not cur:
            return
        segments.append(
            {
                "start": cur[0]["start"],
                "end": cur[-1]["end"],
                "text": " ".join(w["word"] for w in cur),
                "no_speech_prob": 0.0,
                "words": [
                    {
                        "word": w["word"],
                        "start": w["start"],
                        "end": w["end"],
                        "probability": w.get("probability", 0.0),
                    }
                    for w in cur
                ],
            }
        )
        cur.clear()

    for i, w in enumerate(words):
        if cur and (
            w["start"] - cur[-1]["end"] > max_gap
            or len(cur) >= max_words
            or w["start"] - cur[0]["start"] > max_span
        ):
            flush()
        cur.append(w)
        if SENTENCE_END.search(w["word"]):
            flush()
    flush()
    return segments


def transcribe_two_pass(args):
    report("timing")
    print(f"timing pass: {args.timing_model}", file=sys.stderr, flush=True)
    _, _, timing_segments = timing_pass(args.timing_model, args)
    timing_words = []
    for seg in timing_segments:
        timing_words.extend(seg["words"])
    if not timing_words:
        timing_words = [
            {"word": w["word"], "start": w["start"], "end": w["end"], "probability": 0.0}
            for seg in timing_segments
            for w in [{"word": seg["text"], "start": seg["start"], "end": seg["end"], "probability": 0.0}]
            if w["word"].strip()
        ]

    report("text")
    print(f"text pass: {args.model}", file=sys.stderr, flush=True)
    text = text_pass(args.model, args)
    if not text:
        print("text pass produced nothing", file=sys.stderr)
        return None

    report("align")
    words, ratio = align_words(timing_words, text)
    print(f"alignment ratio: {ratio:.2f} ({len(words)} tokens)", file=sys.stderr, flush=True)
    if ratio < 0.45:
        # Transcripts are too far apart to trust: keep the timing model's own text.
        print("alignment too weak - falling back to timing model transcript", file=sys.stderr)
        return None

    segments = build_segments(words)
    return args.language, text, segments


# --------------------------------------------------------------------------- #

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("media")
    parser.add_argument("--model", default="Qualcomm-AI-Research/PhoASR-whisper-small")
    parser.add_argument(
        "--timing-model",
        default="BuzzASR/vietnamese",
        help="model that provides word timings when --model has no timestamps",
    )
    parser.add_argument("--language", default="vi", help="language code, or 'auto' to detect")
    parser.add_argument("--prompt", default=None)
    parser.add_argument("--task", default="transcribe", choices=["transcribe", "translate"])
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    report("prepare")
    language = args.language or "vi"
    if language in ("auto", "", "detect"):
        report("language")
        detection_ref = args.timing_model if looks_like_hf_repo(args.model) else args.model
        language = detect_language(args.media, detection_ref)
        args.language = language
    result = None

    if looks_like_hf_repo(args.model):
        try:
            result = transcribe_two_pass(args)
        except ImportError as exc:
            print(f"two-pass unavailable ({exc}); falling back to timing model", file=sys.stderr)

    if result is None:
        path = args.model
        if looks_like_hf_repo(path):
            path = args.timing_model if looks_like_hf_repo(args.timing_model) else ensure_ct2(args.timing_model)
        elif not (os.path.isdir(path) or looks_like_whisper_name(path)):
            path = ensure_ct2(path)
        report("timing")
        language, text, segments = transcribe_ct2(path, args)
        result = (language, text, segments)

    language, text, segments = result
    report("srt")
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(
            {"language": language, "text": text, "segments": segments},
            fh,
            ensure_ascii=False,
            indent=1,
        )
    print(f"segments: {len(segments)}", file=sys.stderr)
    report("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
