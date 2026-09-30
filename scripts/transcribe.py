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
import math
import os
import re
import shutil
import sys
import unicodedata

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(PROJECT_DIR, "models")

# A CTranslate2 whisper int8 checkpoint is at least a few tens of MB; anything
# smaller is a truncated download and would crash deep inside ctranslate2.
MIN_MODEL_BYTES = 32 * 1024 * 1024

VAD_PARAMETERS = {
    "threshold": 0.5,
    "min_silence_duration_ms": 300,
    "speech_pad_ms": 100,
}

WHISPER_NAME = re.compile(r"^(tiny|base|small|medium|large-v2|large-v3|large-v3-turbo|turbo)(\.en)?$")

SENTENCE_END = re.compile(r"[.!?…][\"'”’)\]]*$")


def report(phase: str) -> None:
    """Machine-readable progress marker consumed by the API server."""
    print(f"##PROG## {json.dumps({'phase': phase})}", flush=True)


def progress(percent: float, message: str) -> None:
    """Fine-grained progress (chunk n/N) for the API's percentage bar."""
    print(f"##PCT## {json.dumps({'percent': percent, 'message': message})}", flush=True)


def detect_language(media: str, model_ref: str, default: str = "vi"):
    """Language detection reuses the timing model so nothing extra is downloaded."""
    try:
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio

        path = resolve_local_model(model_ref)
        model = WhisperModel(path, device="cpu", compute_type="int8")
        audio = decode_audio(media, sampling_rate=16000)[: 30 * 16000]
        result = model.detect_language(audio)
        # faster-whisper 1.x returns (code, probability, all_probs); older builds
        # returned a pair or a dict — all three shapes must work, otherwise every
        # run silently falls back to the default language.
        if isinstance(result, tuple) and len(result) >= 2 and isinstance(result[0], str):
            code, probability = result[0], float(result[1])
        elif isinstance(result, dict):
            code, probability = max(result.items(), key=lambda item: float(item[1]))
        elif isinstance(result, (list, tuple)) and len(result) == 2 and isinstance(result[0], str):
            code, probability = result[0], float(result[1])
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
    if model_ok(out_dir):
        return out_dir
    if os.path.isdir(out_dir):
        print(
            f"model.bin thiếu hoặc hỏng trong {out_dir} — xoá và convert lại",
            file=sys.stderr,
            flush=True,
        )
        shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(MODELS_DIR, exist_ok=True)
    print(f"converting {repo_id} -> {out_dir} (one time)...", file=sys.stderr, flush=True)
    from ctranslate2.converters.transformers import TransformersConverter

    converter = TransformersConverter(
        repo_id, copy_files=["tokenizer.json", "preprocessor_config.json"]
    )
    try:
        converter.convert(out_dir, quantization="int8")
    except Exception as exc:  # noqa: BLE001 - keep the message actionable for the UI
        shutil.rmtree(out_dir, ignore_errors=True)
        raise RuntimeError(
            f"Không convert được model '{repo_id}' sang CTranslate2 ({exc}). "
            f"Kiểm tra mạng rồi chạy lại; nếu vẫn lỗi hãy xoá {MODELS_DIR} và thử lại."
        ) from exc
    if not model_ok(out_dir):
        shutil.rmtree(out_dir, ignore_errors=True)
        raise RuntimeError(f"Convert model '{repo_id}' ra file không hợp lệ — thử lại sau.")
    return out_dir


def model_ok(path: str) -> bool:
    """True when `path` is a usable CTranslate2 model directory (not a partial download)."""
    if not path or not os.path.isdir(path):
        return False
    weights = os.path.join(path, "model.bin")
    try:
        return os.path.isfile(weights) and os.path.getsize(weights) >= MIN_MODEL_BYTES
    except OSError:
        return False


def resolve_local_model(model_ref: str) -> str:
    """Resolve a model reference to a **local** directory (or a plain whisper name).

    A Hugging Face repo id must never reach `WhisperModel`: faster-whisper would
    `snapshot_download()` it and then die with
    `Unable to open file 'model.bin' in model '.../snapshots/<hash>'` because the
    repo ships transformers weights, not CTranslate2 ones.
    """
    ref = model_ref
    if ref.startswith("models/"):
        ref = os.path.join(PROJECT_DIR, ref)
    if looks_like_whisper_name(ref):
        return ref
    if os.path.isdir(ref) and (not looks_like_hf_repo(ref) or model_ok(ref)):
        return ref
    return ensure_ct2(ref)


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
    path = resolve_local_model(model_ref)
    print(f"timing model -> {path}", file=sys.stderr, flush=True)
    return transcribe_ct2(path, args)


# --------------------------------------------------------------------------- #
# chunked timing pass — split, parallel, checkpointed, resumable
# --------------------------------------------------------------------------- #

# A run killed at 80% restarts from the checkpoints in this directory instead
# of paying for the whole video again. It lives next to `transcript.json`, so
# it follows the video across retries of the same job.
WORKDIR_NAME = "chunks"
CHUNK_OVERLAP_SEC = 1.0

# One model per worker process, reused for every chunk that lands on it —
# loading the weights dwarfs the cost of transcribing a 60-second slice.
_WORKER_STATE = {"model": None, "opts": None, "threads": 0}


def chunk_seconds() -> float:
    try:
        return max(10.0, float(os.environ.get("SUBTOOL_CHUNK_SEC") or 60.0))
    except (TypeError, ValueError):
        return 60.0


def available_ram_gb():
    """Free RAM, so worker count never outruns the model copies we can afford."""
    try:
        if os.name == "nt":
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):  # noqa: N801 - Windows API name
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                return stat.ullAvailPhys / 1024**3
            return None
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / 1024**2
    except OSError:
        return None
    return None


def default_workers() -> int:
    """Parallel timing workers: capped by CPU *and* by RAM (a model per worker)."""
    raw = os.environ.get("SUBTOOL_WORKERS")
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    workers = max(1, min(4, (os.cpu_count() or 2) - 1))
    ram = available_ram_gb()
    if ram is not None:
        workers = max(1, min(workers, int(ram // 4)))  # ~4 GB headroom per model
    return workers


def media_duration(media: str):
    """Video length in seconds, or None when the container will not cooperate."""
    try:
        import av

        with av.open(media) as container:
            if container.duration:
                return float(container.duration) / 1_000_000.0
    except Exception as exc:  # noqa: BLE001 - the caller falls back to one pass
        print(f"không đo được thời lượng ({exc})", file=sys.stderr, flush=True)
    return None


def media_fingerprint(media: str):
    try:
        stat = os.stat(media)
        return {"size": stat.st_size, "mtime": int(stat.st_mtime)}
    except OSError:
        return None


def workdir_for(out_path: str) -> str:
    return os.path.join(os.path.dirname(os.path.abspath(out_path)), WORKDIR_NAME)


def run_manifest(args, chunk_sec: float) -> dict:
    """Everything that decides whether old checkpoints may be reused.

    Deliberately built from the *raw* CLI values (the language argument as
    typed, not the detected one) so it stays identical between runs.
    """
    return {
        "media": media_fingerprint(args.media),
        "model": args.model,
        "timing_model": args.timing_model,
        "language_arg": getattr(args, "language_arg", args.language),
        "task": args.task,
        "beam": args.beam_size,
        "prompt": args.prompt or None,
        "chunk_sec": chunk_sec,
    }


def prepare_workdir(args) -> str:
    """Creates the checkpoint directory, clearing it when the manifest changed.

    Returns None when the directory cannot be used — the job then simply runs
    without resume support instead of failing.
    """
    work = workdir_for(args.out)
    manifest_path = os.path.join(work, "manifest.json")
    manifest = run_manifest(args, chunk_seconds())
    try:
        os.makedirs(work, exist_ok=True)
        current = None
        if os.path.isfile(manifest_path):
            try:
                with open(manifest_path, encoding="utf-8") as fh:
                    current = json.load(fh)
            except (OSError, ValueError):
                current = None
        if current != manifest:
            # Different video / language / chunk size: nothing here is reusable.
            for name in os.listdir(work):
                try:
                    os.remove(os.path.join(work, name))
                except OSError:
                    pass
            with open(manifest_path, "w", encoding="utf-8") as fh:
                json.dump(manifest, fh, ensure_ascii=False, indent=1)
        return work
    except OSError as exc:
        print(f"CẢNH BÁO: không ghi được checkpoint ({exc}) — chạy không resume", file=sys.stderr, flush=True)
        return None


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _write_json(path, payload):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError as exc:  # a full disk must not kill the job
        print(f"CẢNH BÁO: không ghi được checkpoint {path} ({exc})", file=sys.stderr, flush=True)


def write_audio_chunks(media, work, chunk_sec, total_sec):
    """Stream the audio once into overlapping 16 kHz mono WAV slices.

    Decoding is the expensive half of a long video, so it happens exactly once;
    every timing worker then reads plain PCM directly. Chunks overlap by
    CHUNK_OVERLAP_SEC so a word straddling a cut is seen by both sides.
    """
    import av
    import wave

    rate = 16000
    n_chunks = max(1, int(math.ceil(total_sec / chunk_sec - 1e-9)))
    ranges = []
    for i in range(n_chunks):
        lo = max(0, int(round((i * chunk_sec - CHUNK_OVERLAP_SEC) * rate)))
        # The last chunk stays open-ended: the container's reported duration can
        # be slightly shorter than the decoded audio, and no sample may be lost.
        hi = (
            10**12
            if i == n_chunks - 1
            else int(round((i + 1) * chunk_sec + CHUNK_OVERLAP_SEC) * rate)
        )
        if hi <= lo:
            hi = lo + rate
        ranges.append((lo, hi))

    paths = [os.path.join(work, f"audio_{i:04d}.wav") for i in range(n_chunks)]
    writers = {}
    cursor = 0

    def emit(pcm):
        nonlocal cursor
        start = cursor
        cursor = start + len(pcm)
        for i, (lo, hi) in enumerate(ranges):
            s, e = max(start, lo), min(cursor, hi)
            if s >= e:
                continue
            writer = writers.get(i)
            if writer is None:
                writer = wave.open(paths[i], "wb")
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(rate)
                writers[i] = writer
            writer.writeframes(pcm[s - start : e - start].tobytes())

    container = av.open(media)
    resampler = av.AudioResampler(format="s16", layout="mono", rate=rate)
    try:
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                emit(out.to_ndarray().reshape(-1).astype("int16", copy=False))
        for out in resampler.resample(None):  # flush what the resampler buffered
            emit(out.to_ndarray().reshape(-1).astype("int16", copy=False))
    finally:
        for writer in writers.values():
            writer.close()
        try:
            container.close()
        except Exception:  # noqa: BLE001
            pass

    specs = []
    for i, (lo, hi) in enumerate(ranges):
        path = paths[i]
        if not os.path.isfile(path) or os.path.getsize(path) <= 44:  # header only
            continue  # no audio in this window: nothing to transcribe
        specs.append(
            {
                "index": i,
                "path": path,
                "offset": lo / rate,
                "region": i * chunk_sec,
                "region_end": total_sec if i == n_chunks - 1 else (i + 1) * chunk_sec,
                "checkpoint": os.path.join(work, f"timing_{i:04d}.json"),
            }
        )
    return specs


def timing_opts(args):
    return {
        "language": args.language,
        "task": args.task,
        "beam_size": args.beam_size,
        "prompt": args.prompt or None,
    }


def run_timing_chunk(model, spec, opts):
    """One chunk → words in absolute video time (the caller checkpoints it)."""
    segments, _info = model.transcribe(
        spec["path"],
        language=opts["language"],
        task=opts["task"],
        vad_filter=True,
        vad_parameters=VAD_PARAMETERS,
        condition_on_previous_text=False,
        beam_size=opts["beam_size"],
        word_timestamps=True,
        initial_prompt=opts["prompt"],
    )
    words = []
    for seg in segments:
        for word in seg.words or []:
            words.append(
                {
                    "word": word.word,
                    "start": float(word.start) + spec["offset"],
                    "end": float(word.end) + spec["offset"],
                    "probability": float(getattr(word, "probability", 0.0) or 0.0),
                }
            )
    return {"index": spec["index"], "words": words}


def _pool_init(model_path, opts, threads):
    from faster_whisper import WhisperModel

    _WORKER_STATE["model"] = WhisperModel(
        model_path, device="cpu", compute_type="int8", cpu_threads=threads
    )
    _WORKER_STATE["opts"] = opts


def _pool_run(spec):
    payload = run_timing_chunk(_WORKER_STATE["model"], spec, _WORKER_STATE["opts"])
    _write_json(spec["checkpoint"], payload)
    return spec["index"]


def _stop_pool(pool):
    """Tear the workers down without ever blocking: results are on disk already."""
    try:
        procs = getattr(pool, "_processes", None)
        if isinstance(procs, dict):
            procs = list(procs.values())
        elif procs:
            procs = list(procs)
        else:
            procs = []
        for proc in procs:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001 - the process may already be gone
                pass
        pool.shutdown(wait=False, cancel_futures=True)
    except Exception:  # noqa: BLE001 - cleanup must never fail the job
        pass


def merge_chunk_words(results, chunk_sec):
    """Overlapping chunks can report the same word twice — keep each word once.

    A word starting inside its own chunk is always kept; one found in the
    overlap *before* a chunk's region is only kept when no earlier chunk
    already reported a word at that moment.
    """
    merged, cells = [], set()
    for result in sorted(results, key=lambda item: item["index"]):
        region = result["index"] * chunk_sec
        for word in result["words"]:
            cell = int(round(word["start"] * 10))  # 0.1 s grid
            if word["start"] < region - 1e-6 and any(
                cell + delta in cells for delta in range(-3, 4)
            ):
                continue  # the owning chunk already produced this word
            cells.add(cell)
            merged.append(word)
    merged.sort(key=lambda word: word["start"])
    return merged


def _chunked_timing(model_ref, args, work):
    path = resolve_local_model(model_ref)
    print(f"timing model -> {path}", file=sys.stderr, flush=True)
    total = media_duration(args.media)
    if not total or total <= 0:
        raise RuntimeError("không đo được thời lượng video")

    chunk_sec = chunk_seconds()
    specs = write_audio_chunks(args.media, work, chunk_sec, total)
    if not specs:
        raise RuntimeError("không tách được đoạn âm thanh nào")
    workers = default_workers()
    print(
        f"chunks: {len(specs)} × {chunk_sec:g}s · overlap {CHUNK_OVERLAP_SEC:g}s · {workers} worker",
        file=sys.stderr,
        flush=True,
    )

    opts = timing_opts(args)
    results, pending = [], []
    for spec in specs:
        cached = _read_json(spec["checkpoint"])
        if isinstance(cached, dict) and isinstance(cached.get("words"), list):
            results.append(cached)
            print(
                f"chunk {spec['index'] + 1}/{len(specs)}: dùng checkpoint ({len(cached['words'])} từ)",
                file=sys.stderr,
                flush=True,
            )
        else:
            pending.append(spec)

    def note(finished):
        progress(
            25 + 30 * finished / max(1, len(specs)),
            f"timing {finished}/{len(specs)} chunk · {sum(len(r['words']) for r in results)} từ",
        )

    if pending:
        if workers > 1 and len(pending) > 1:
            from concurrent.futures import ProcessPoolExecutor, as_completed
            from multiprocessing import get_context

            threads = max(1, (os.cpu_count() or 2) // min(workers, len(pending)))
            pool = ProcessPoolExecutor(
                max_workers=min(workers, len(pending)),
                # `spawn`, not the Linux default `fork`: language detection has
                # already started torch/ctranslate2 in *this* process, and a
                # forked child inherits their locks → it deadlocks before it can
                # transcribe anything (it also matches how Windows always runs).
                mp_context=get_context("spawn"),
                initializer=_pool_init,
                initargs=(path, opts, threads),
            )
            try:
                futures = {pool.submit(_pool_run, spec): spec for spec in pending}
                finished = len(results)
                # Safety net: a wedged worker must slow the job down, not hang it.
                budget = max(1800, 600 * len(pending) // min(workers, len(pending)))
                for future in as_completed(futures, timeout=budget):
                    spec = futures[future]
                    future.result()  # a raise here falls back to a single pass
                    saved = _read_json(spec["checkpoint"])
                    results.append(saved if isinstance(saved, dict) else {"index": spec["index"], "words": []})
                    finished += 1
                    note(finished)
            except TimeoutError:
                raise RuntimeError(
                    f"pool kẹt quá {budget}s — dừng worker và chạy lại một lần"
                ) from None
            finally:
                _stop_pool(pool)
        else:
            from faster_whisper import WhisperModel

            model = WhisperModel(path, device="cpu", compute_type="int8")
            finished = len(results)
            for spec in pending:
                payload = run_timing_chunk(model, spec, opts)
                _write_json(spec["checkpoint"], payload)
                results.append(payload)
                finished += 1
                note(finished)

    words = merge_chunk_words(results, chunk_sec)
    print(f"timing words: {len(words)} từ ({len(results)} chunk)", file=sys.stderr, flush=True)
    if not words:
        raise RuntimeError("các chunk không trả về từ nào")
    text = " ".join(word["word"].strip() for word in words if word["word"].strip())
    return args.language, text, build_segments(words)


def chunked_timing_pass(model_ref, args):
    """Word timings, chunked and parallel when possible.

    Any failure degrades to the original single-pass call: this path may only
    ever make the job slower, never kill it.
    """
    work = getattr(args, "workdir", None)
    try:
        if not work:
            raise RuntimeError("không dùng được thư mục checkpoint")
        return _chunked_timing(model_ref, args, work)
    except Exception as exc:  # noqa: BLE001 - degrade, never die here
        print(
            f"CẢNH BÁO: chia đoạn thất bại ({exc}) — chạy mô hình một lần",
            file=sys.stderr,
            flush=True,
        )
        path = resolve_local_model(model_ref)
        print(f"timing model -> {path}", file=sys.stderr, flush=True)
        return transcribe_ct2(path, args)


def text_pass(repo_id, args):
    """Clean Vietnamese text (no timestamps) from a VN fine-tuned whisper."""
    import torch
    from faster_whisper.audio import decode_audio
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
    # transformers decodes filenames by piping them into `ffmpeg -i pipe:0`, and a
    # pipe cannot be seeked: MP4s whose moov atom sits at the end (ffmpeg's default,
    # no +faststart) decode to zero bytes and raise "Soundfile is not in the correct
    # format". PyAV opens the file directly, so hand the pipeline a raw waveform.
    audio = decode_audio(args.media, sampling_rate=16000)
    out = asr({"raw": audio, "sampling_rate": 16000}, generate_kwargs=generate_kwargs)
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
    timing_lang, timing_text, timing_segments = chunked_timing_pass(args.timing_model, args)
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
    text = None
    text_cache = os.path.join(args.workdir, "text.json") if getattr(args, "workdir", None) else None
    if text_cache:
        cached = _read_json(text_cache)
        if isinstance(cached, dict) and cached.get("model") == args.model and cached.get(
            "language"
        ) == args.language:
            text = cached.get("text") or ""
            print(f"text pass (checkpoint): {len(text)} ký tự", file=sys.stderr, flush=True)
    if text is None:
        try:
            text = text_pass(args.model, args)
        except Exception as exc:  # noqa: BLE001 - a broken text pass must not kill the job
            print(f"LỖI text pass: {exc}", file=sys.stderr, flush=True)
            text = ""
        if text and text_cache:
            # The text pass is the slowest single step (~1-2 min): keep its
            # result so an interrupted run resumes straight past it.
            _write_json(text_cache, {"model": args.model, "language": args.language, "text": text})
    if not text:
        # Keep the job alive: the timing model already produced a usable transcript.
        print(
            "CẢNH BÁO: text pass rỗng — dùng transcript của timing model (chuẩn chính tả kém hơn)",
            file=sys.stderr,
            flush=True,
        )
        return args.language, timing_text, timing_segments

    report("align")
    words, ratio = align_words(timing_words, text)
    print(f"alignment ratio: {ratio:.2f} ({len(words)} tokens)", file=sys.stderr, flush=True)
    if ratio < 0.45:
        # Transcripts are too far apart to trust: keep the timing model's own text.
        print(
            "CẢNH BÁO: alignment yếu (<0.45) — dùng transcript của timing model",
            file=sys.stderr,
            flush=True,
        )
        return args.language, timing_text, timing_segments

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
    # Kept verbatim: the checkpoint manifest must not change when auto-detect
    # resolves to a different language on a later run.
    args.language_arg = args.language or "vi"
    args.workdir = prepare_workdir(args)

    report("prepare")
    two_pass = looks_like_hf_repo(args.model)
    print(f"python     : {sys.executable} ({sys.version.split()[0]})", file=sys.stderr, flush=True)
    print(f"media      : {args.media}", file=sys.stderr, flush=True)
    print(f"model      : {args.model}", file=sys.stderr, flush=True)
    print(f"timing     : {args.timing_model}", file=sys.stderr, flush=True)
    print(f"language   : {args.language} | task {args.task} | beam {args.beam_size}", file=sys.stderr, flush=True)

    # Fail fast (and loudly) before touching a 3-minute video when the model is unusable.
    if two_pass:
        try:
            print(f"timing path: {resolve_local_model(args.timing_model)}", file=sys.stderr, flush=True)
        except Exception as exc:  # noqa: BLE001 - surfaced as the job's error message
            print(f"LỖI: {exc}", file=sys.stderr, flush=True)
            return 1

    language = args.language or "vi"
    if language in ("auto", "", "detect"):
        report("language")
        detection_ref = args.timing_model if two_pass else args.model
        cached = _read_json(os.path.join(args.workdir, "language.json")) if args.workdir else None
        if isinstance(cached, dict) and cached.get("fingerprint") == media_fingerprint(args.media):
            language = cached.get("language") or detection_ref
            print(f"nhận diện ngôn ngữ (checkpoint): {language}", file=sys.stderr, flush=True)
        else:
            language = detect_language(args.media, detection_ref)
            if args.workdir:
                _write_json(
                    os.path.join(args.workdir, "language.json"),
                    {"fingerprint": media_fingerprint(args.media), "language": language},
                )
        args.language = language
    result = None

    if two_pass:
        try:
            result = transcribe_two_pass(args)
        except ImportError as exc:
            print(f"two-pass unavailable ({exc}); falling back to timing model", file=sys.stderr)

    if result is None:
        # Single pass (or two-pass unavailable): still a *local* model — a HF repo id
        # would make faster-whisper download transformers weights and crash on model.bin.
        ref = args.timing_model if two_pass else args.model
        try:
            path = resolve_local_model(ref)
        except Exception as exc:  # noqa: BLE001
            print(f"LỖI: {exc}", file=sys.stderr, flush=True)
            return 1
        print(f"single pass: {path}", file=sys.stderr, flush=True)
        report("timing")
        language, text, segments = chunked_timing_pass(ref, args)
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
