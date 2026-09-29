# PLAN — Dọn dẹp repo → Git commit → Gói Portable Zero-Install

**Mục tiêu cuối:** gửi bạn `release/sub-tool-win64-1.0.0.zip` (~1.2GB) → họ giải nén →
bấm đúp `start.cmd` → trình duyệt mở `http://localhost:4174` → dùng đủ 7 bước UI.
**Không cài Node, không cài Python, không cài ffmpeg, không mở terminal.**

Đã chốt với user: Windows 64-bit · zip ~1.2GB · model 1.7GB tải mạng lần đầu ·
không Docker · không kèm model · có Git commit.

---

## Phase A — Dọn dẹp repo + Git commit

### A1. Xóa file chết ở root
- [ ] `.work_audio.wav` (0.53MB) — audio tạm
- [ ] `video_subbed.mp4` (11.9MB) — output render cũ (tạo lại được)
- [ ] `venv/` (5 file, layout POSIX `bin/`) — dead: `env.js` tìm `venv/Scripts/python.exe`
      (không tồn tại) và `.venv` luôn được ưu tiên
- [ ] `storage/<20 job uuid>/` (116MB) — dữ liệu QA cũ; **giữ** `storage/fonts.json` (đặt lại `[]`)

### A2. Dọn `.work/` (274MB → giữ ~0.3MB)
- [ ] **GIỮ:** `georgia.ttf` (QA `scripts/qa-ui.mjs` scenario 06d cần),
      `verify-*.mjs` (4 script QA), `qa/` (thư mục output screenshot)
- [ ] **XÓA:** `*.log` (12 file), `qa-*-profile/` (3 profile Chrome tự sinh lại),
      `dev-look.pid`, `test_*.py`, `transcript_test.json`, `sep/`, `dev-font.log`

### A3. Model (`models/` 3.95GB, gitignore — không ảnh hưởng commit)
- [ ] **Xác minh slug trước khi xóa:** code dùng mặc định
      `Qualcomm-AI-Research/PhoASR-whisper-small` → dir `phoasr-whisper-small` ✅ và
      `BuzzASR/vietnamese` → dir `BuzzASR-vietnamese` ✅
- [ ] Nếu đúng: xóa `buzzasr-vi/` (1.48GB, tên cũ) + `phowhisper-medium/` (742MB, leftover
      experiment) → frees 2.2GB. **Không chắc thì GIỮ** (chúng không vào git).

### A4. Smoke test sau dọn dẹp
- [ ] `npm run doctor` / `GET /api/health` vẫn xanh (Python từ `.venv`, ffprobe ok)
- [ ] Server vẫn start, upload `video.mp4` vẫn probe được

### A5. Thêm file cấu hình repo (P1)
- [ ] `.gitignore`: `node_modules/ .venv/ venv/ models/ storage/ .work/ release/
      web/dist/ dist/ video_subbed.mp4 .work_*.wav public/input_* *.log`
- [ ] `requirements.txt` (5 gói, dòng 1 là `--extra-index-url https://download.pytorch.org/whl/cpu`):
      `faster-whisper==1.2.1`, `ctranslate2==4.8.2`, `torch==2.14.0+cpu`,
      `transformers==5.17.0`, `sentencepiece==0.2.2`
      (đã xác minh `demucs/librosa/scipy/sklearn/accelerate` **không file nào import**)
- [ ] `README.md` (tiếng Việt, 2 phần):
      - **A. Người dùng:** tải zip → giải nén → `start.cmd` → mở 4174 → lần đầu
        Transcribe tải ~1.7GB model
      - **B. Dev:** Node ≥20 + Python 3.10–3.12 (ffmpeg/Chrome = tùy chọn) →
        `npm install` → `npm run setup` → `npm run dev` (5173) · `npm run build && npm start`
        (4174) · CLI `npm run sub` · `npm run doctor` · `npm run build-portable` · QA ·
        bảng lỗi thường gặp
- [ ] `package.json`:
      - `engines: {"node": ">=20"}`
      - scripts: `setup`, `doctor`, `build-portable`
      - chuyển `vite`, `@vitejs/plugin-react`, `typescript`, `@types/*` → `devDependencies`
        (server production không dùng → `npm ci --omit=dev` lúc đóng gói nhẹ hơn)
- [ ] `scripts/setup.mjs` (mới, reuse `resolvePython/checkPython/checkCommand` từ `server/env.js`):
      - `npm run doctor` = chỉ in bảng ✅/❌ tiếng Việt (Node, Python, ffprobe, Chrome, models/)
      - `npm run setup` = tìm Python 3.10–3.12 → tạo `.venv` nếu thiếu →
        `pip install -r requirements.txt` (stdio inherit) → in checklist → gợi ý `npm run dev`
- [ ] Verify: `npm run typecheck` ✅ · `npm run build` ✅ · `npm run doctor` ✅

### A6. Git init + commit
- [ ] `git init` (kiểm tra `user.name`/`user.email` có sẵn, không thì cấu hình tạm local)
- [ ] `git status` audit: **không** staged `node_modules .venv models storage .work web/dist release`
- [ ] Commit 1: `chore: dọn dẹp repo + cấu hình (gitignore, requirements, README, setup)`
- [ ] Kiểm tra `git ls-files | wc` hợp lý (code + config + font + video demo, không có rác)

---

## Phase B — Gói Portable Zero-Install

### B1. SPIKE — test Python embeddable TRƯỚC (cổng quyết định, 45')
- [ ] Tải `python-3.12.x-embed-amd64.zip` + `get-pip.py` → `.work/runtimes/` (cache)
- [ ] Mở `import site` trong `python312._pth` → cài 5 gói từ `requirements.txt`
- [ ] Test: `import faster_whisper, ctranslate2, torch, transformers, sentencepiece`
- [ ] Chạy thật: cắt clip ngắn từ `video.mp4` → `scripts/detect_language.py` +
      `scripts/transcribe.py` (dùng `models/` sẵn có, không tải)
- [ ] **PASS → làm tiếp · FAIL → DỪNG, báo user chọn Plan B** (yêu cầu cài Python, hoặc Docker)

### B2. Bỏ hẳn ffmpeg (45')
- [ ] `lib/probe.mjs` (mới): `@remotion/media-parser` đọc
      `dimensions/fps/durationInSeconds/audioCodec/containerFormat` + `fs.stat` (size) +
      bitRate tự tính → **fallback `ffprobe`** nếu máy có → cả hai fail: lỗi tiếng Việt
- [ ] `server/probe.js` re-export từ `lib/probe.mjs`; `cli.mjs:173` dùng chung `probeVideo`
- [ ] Test: probe `mp4/webm/mov/mkv` (dùng ffmpeg tạo mẫu) · chạy với PATH **không** có
      ffprobe (mô phỏng máy bạn tôi) · file hỏng → lỗi tiếng Việt
- [ ] Health (`/api/health`): thêm `node` version, browser thật (`getBrowserExecutable()`
      thay vì echo env `REMOTION_BROWSER` — đang hiểu nhầm), model cache;
      ffprobe đánh dấu là **tùy chọn**

### B3. `scripts/build-portable.mjs` (1.5h)
- [ ] Bước: `npm run build` (vite → `web/dist`) → dựng staging allow-list
      (code, `web/dist`, `public/`, `video.mp4`, `video.srt`, `package*.json`, lock) →
      `npm ci --omit=dev` trong staging → tải runtime (cache `.work/runtimes/`):
      Node portable `node-v22*-win-x64.zip` + Python embeddable → bake 5 gói pip vào
      `runtime\python` → sinh `start.cmd` + `README.txt` → nén `tar.exe -a -cf` →
      `release/sub-tool-win64-1.0.0.zip` (~1.2GB)
- [ ] `start.cmd`: set `PYTHON=%~dp0runtime\python\python.exe`
      (`env.js:13` **đã hỗ trợ `process.env.PYTHON` sẵn**, không sửa server) →
      chạy `runtime\node\node.exe server\index.js` (single port 4174, serve `web/dist`) →
      mở trình duyệt `http://localhost:4174`
- [ ] Giữ lại được `.work/runtimes/` cache → lần sau build chỉ ~5 phút

### B4. Verify E2E — đúng kịch bản máy bạn tôi (1h)
- [ ] Giải nén zip vào `%TEMP%` → chạy `start.cmd` → trình duyệt tự mở 4174
- [ ] Health xanh: Python từ `runtime\`, browser detect Edge/Chrome, **không cần ffprobe**
- [ ] Full flow: upload `video.mp4` → Language → **Transcribe tải model 1.7GB thật** →
      Review → Save → Style (kể cả upload font) → Render → có `video_subbed.mp4`
- [ ] Soi zip: không chứa `.venv/`, `storage/`, `.work/`, file rác QA
- [ ] Trên source: `npm run typecheck` ✅ · `npm run build` ✅ · `npm run doctor` ✅
- [ ] Dọn `%TEMP%` (~4GB)

### B5. Commit cuối + báo cáo
- [ ] Commit 2: `feat: gói portable zero-install + bỏ phụ thuộc ffprobe`
- [ ] Báo user: đường dẫn zip, dung lượng, cách gửi, cách rebuild sau khi sửa code

---

## Rủi ro & Plan B

| Rủi ro | Xử lý |
|---|---|
| **B1 fail** (Python embeddable không chạy được torch/ct2) | Dừng → user chọn: (a) giữ prereq Python + `setup.mjs`, (b) Docker |
| pip resolve transitive lệch so với `.venv` đang chạy | E2E b4 sẽ bắt; pin thêm gói nếu cần |
| media-parser chưa đọc được container lạ | fallback `ffprobe` + lỗi tiếng Việt đã có |
| allow-list thiếu file lẻ | E2E từ zip sẽ lộ ngay → bổ sung |
| Remotion không tìm thấy browser ở máy bạn tôi | `getBrowserExecutable()` đã detect Edge (có sẵn mọi máy Win) → fallback Remotion tự tải headless shell |

## Tiêu chí hoàn thành (Definition of Done)
1. Repo sạch: `git status` sạch, không file chết, typecheck+build pass
2. `release/sub-tool-win64-1.0.0.zip` tồn tại, ~1.2GB
3. E2E từ zip chạy đủ flow ra `video_subbed.mp4` trên môi trường sạch %TEMP%
4. User biết 2 câu: cách gửi zip, cách rebuild
