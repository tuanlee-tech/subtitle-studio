#!/usr/bin/env python3
"""Tải sẵn toàn bộ model AI vào models/ (gọi lại đúng logic resolve của transcribe.py).

Chạy bởi `npm run setup` sau khi pip xong. Thất bại không block setup —
caller (setup.mjs) bắt và cảnh báo; model sẽ tự tải lần đầu bấm Transcribe.

Model bản dịch (Helsinki-NLP/opus-mt-*) không tải ở đây: mỗi cặp ngôn ngữ
một repo riêng, tải lazy theo cặp người dùng chọn.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from transcribe import resolve_local_model  # noqa: E402

# Đúng mặc định của transcribe.py --model / --timing-model.
# Language detection dùng chung timing model nên không cải thêm.
MODELS = [
    ("text  ", "Qualcomm-AI-Research/PhoASR-whisper-small"),
    ("timing", "BuzzASR/vietnamese"),
]


def main() -> int:
    for label, ref in MODELS:
        print(f"[{label}] {ref}", file=sys.stderr, flush=True)
        path = resolve_local_model(ref)
        print(f"[{label}] -> {path}", file=sys.stderr, flush=True)
    print("models: sẵn sàng", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
