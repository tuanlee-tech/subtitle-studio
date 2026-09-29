#!/usr/bin/env python3
"""Translate a transcript JSON into another language (Helsinki-NLP opus-mt).

Reads  {"language", "text", "segments":[{start,end,text,words:[...]}]}
Writes the same shape, with `text` translated and `words` redistributed evenly
across each segment (word timings stay valid, the text no longer maps 1:1).
"""
import argparse
import json
import sys

ALIASES = {
    "vi": ["vi", "vie"],
    "en": ["en", "eng"],
    "ja": ["ja", "jpn"],
    "ko": ["ko", "kor"],
    "zh": ["zh", "zho", "cmn", "chi"],
    "fr": ["fr", "fra"],
    "de": ["de", "deu"],
    "es": ["es", "spa"],
}


def codes_for(lang: str):
    return ALIASES.get(lang, [lang])


def load_pair(src_codes, tgt_codes):
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    tried = []
    for s in src_codes:
        for t in tgt_codes:
            name = f"Helsinki-NLP/opus-mt-{s}-{t}"
            tried.append(name)
            try:
                tokenizer = AutoTokenizer.from_pretrained(name)
                model = AutoModelForSeq2SeqLM.from_pretrained(name)
                print(f"using {name}", file=sys.stderr, flush=True)
                return tokenizer, model
            except Exception as exc:  # noqa: BLE001 - model repos vary in availability
                print(f"  {name}: {type(exc).__name__}", file=sys.stderr)
    raise RuntimeError("unavailable: " + ", ".join(tried))


def translate_batch(tokenizer, model, texts):
    if not texts:
        return []
    out = []
    for i in range(0, len(texts), 16):
        batch = texts[i : i + 16]
        tokens = tokenizer(batch, return_tensors="pt", padding=True, truncation=True, max_length=512)
        generated = model.generate(**tokens, max_new_tokens=512)
        out.extend(tokenizer.batch_decode(generated, skip_special_tokens=True))
    return out


def redist_words(segment, text):
    """Keep the segment timing, spread the translated tokens across it."""
    tokens = text.split()
    if not tokens:
        return []
    start, end = segment["start"], segment["end"]
    span = max(0.05, end - start)
    chars = sum(max(1, len(t)) for t in tokens)
    cursor = start
    words = []
    for t in tokens:
        share = span * (max(1, len(t)) / chars)
        w_start = cursor
        w_end = min(end, cursor + share)
        cursor = w_end
        words.append({"word": t + " ", "start": w_start, "end": w_end, "probability": 0.0})
    return words


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="inp", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--src", required=True)
    parser.add_argument("--tgt", required=True)
    args = parser.parse_args()

    with open(args.inp, encoding="utf-8") as fh:
        data = json.load(fh)

    if args.src == args.tgt:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        return 0

    try:
        tokenizer, model = load_pair(codes_for(args.src), codes_for(args.tgt))
    except Exception as direct_err:  # noqa: BLE001
        if args.tgt == "en" or args.src == "en":
            print(f"ERROR: Không thể dịch từ {args.src} sang {args.tgt}: {direct_err}", file=sys.stderr)
            return 2
        # Pivot through English: src -> en -> tgt
        print(f"direct pair unavailable, pivoting via English ({direct_err})", file=sys.stderr)
        try:
            t1, m1 = load_pair(codes_for(args.src), codes_for("en"))
            t2, m2 = load_pair(codes_for("en"), codes_for(args.tgt))
        except Exception as pivot_err:  # noqa: BLE001
            print(f"ERROR: Không thể dịch từ {args.src} sang {args.tgt}: {pivot_err}", file=sys.stderr)
            return 2
        texts = [seg["text"] for seg in data["segments"]]
        mid = translate_batch(t1, m1, texts)
        texts = translate_batch(t2, m2, [t.strip() for t in mid])
        tokenizer, model, texts = None, None, texts
    else:
        texts = translate_batch(tokenizer, model, [seg["text"] for seg in data["segments"]])

    for seg, new_text in zip(data["segments"], texts):
        seg["text"] = " ".join(new_text.split())
        seg["words"] = redist_words(seg, seg["text"])

    data["language"] = args.tgt
    data["text"] = " ".join(seg["text"] for seg in data["segments"]).strip()
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print("translated segments:", len(data["segments"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
