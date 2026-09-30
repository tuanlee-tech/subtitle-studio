# PLAN — Dọn dẹp repo → Git commit → Clone & cài 1 lệnh

**Mục tiêu cuối (mới):** người dùng `git clone` → chạy `./setup.sh` (Windows: `setup.cmd`)
→ `npm run dev` → dùng đủ 7 bước UI. Chỉ cần sẵn Node ≥ 20 + Python 3.10–3.12.

Đã chốt với user (2026-09-30): bỏ hướng portable zip, thay bằng clone + setup script ·
model tải luôn trong setup (có `--skip-model`) · bỏ bắt buộc ffprobe (dùng
`@remotion/media-parser`, ffprobe chỉ là fallback) · có Git commit.

> ## TRẠNG THÁI HIỆN TẠI
> - **Phase A — HOÀN TẤT** (commit `f3d7f66`, 65 file, working tree sạch).
> - **Phase B (portable) — ĐÃ HỦY** theo quyết định user (2026-09-30): thay bằng hướng
>   clone + setup script. Lý do: cross-build Windows zip từ Ubuntu không verify được —
>   pip cross-resolve sai marker `platform_system == "Linux"` (kéo nvidia-cudnn 412MB rồi
>   chốt `nvidia-nccl-cu3`), không chạy được `python.exe` để test embeddable, không có Wine.
>   Toàn bộ kiến thức spike B1 vẫn giữ ở dưới làm tài liệu.
> - **Phase C — Clone & setup 1 lệnh — HOÀN TẤT** (xem mục Phase C bên dưới).

---

## Phase A — Dọn dẹp repo + Git commit ✅ HOÀN TẤT

- [x] **A1. Xóa file chết root:** `.work_audio.wav`, `video_subbed.mp4`, `venv/` (POSIX
      rỗng), 19 job trong `storage/` — `storage/fonts.json` đặt lại `[]` (UTF-8 không BOM)
- [x] **A2. Dọn `.work/`** 274MB → 5.2MB. Giữ: `georgia.ttf` (QA 06d cần), 4 `verify-*.mjs`,
      `qa/`. Xóa 19 mục (log, profile Chrome, test_*.py…); `dev-font.log` xóa được sau khi
      kill dev server nền
- [x] **A3. Model:** xác minh slug → xóa `buzzasr-vi/` + `phowhisper-medium/` +
      `phoasr-whisper-small/` (2.47GB, không code nào tham chiếu). **Giữ**
      `models/BuzzASR-vietnamese/` (timing pass mặc định). Text pass mặc định
      (`Qualcomm-AI-Research/PhoASR-whisper-small`) nằm ở HF cache ngoài repo
- [x] **A4. Smoke test:** `/api/health` xanh, vite 200 sau dọn dẹp
- [x] **A5. File cấu hình:**
      - `.gitignore` (node_modules/.venv/models/storage/.work/web/dist/release…)
      - `requirements.txt` — 5 gói + dòng 1 `--extra-index-url .../whl/cpu` (đã verify: `npm run setup` resolve `torch==2.14.0+cpu` OK)
      - `README.md` — phần A người dùng portable, phần B dev (setup/doctor/build-portable/QA/lỗi thường gặp)
      - `scripts/setup.mjs` — `npm run setup` (tự cài) + `npm run doctor` (chỉ check), reuse `server/env.js`
      - `package.json` — `engines node>=20`, scripts `setup/doctor/build-portable`, **`vite` → devDependencies**
      - `public/fonts/custom/.gitkeep`
      - Verify: `npm run doctor` ✅ · `npm run setup` ✅ · `npm run typecheck` ✅ · `npm run build` ✅
- [x] **A6. Git:** `git init -b main`, identity local `tuanlee <tuanlee@users.noreply.github.com>`
      (user chưa có global identity — sửa bằng `git config user.email` nếu cần),
      audit ignore ✅ (không lọt `.venv/node_modules/models/storage/.work/web/dist`),
      **commit `f3d7f66` "chore: repo cleanup + environment config"** (65 file)

Ghi chú: đã kill 2 process node nền giữ port 4174/5173 (PID 19836, 11008) →
user có thể tự chạy `npm run dev` bình thường.

---

## Phase B — Gói Portable Zero-Install ❌ ĐÃ HỦY (2026-09-30)

> **ĐÃ HỦY** — không làm tiếp. `.work/runtimes/` đã bị xóa; kiến thức spike giữ
> nguyên bên dưới làm tài liệu. Thay thế bằng Phase C (clone & setup 1 lệnh).

### B1. SPIKE — test Python embeddable (cổng quyết định) — ⏸ ~90%

Đã làm (KHÔNG phải làm lại):

- [x] (a) Tải `python-3.12.10-embed-amd64.zip` (10.6MB) + `get-pip.py` → `.work/runtimes/`,
      giải nén vào `.work/runtimes/python/`
- [x] (b) Patch `python312._pth`: bỏ `#` ở dòng `import site` (bắt buộc, không thì pip không thấy)
- [x] (c) `python.exe get-pip.py` → pip 26.2.1 chạy trong bản embeddable
- [x] (d) `pip install -r requirements.txt` → **43 gói thành công** (dùng chung pip cache với
      `.venv` nên nhanh): `torch 2.14.0+cpu`, `transformers 5.17.0`, `faster-whisper 1.2.1`,
      `ctranslate2 4.8.2`, `sentencepiece`, `av`, `onnxruntime`…
- [x] (e) Import test ✅: `faster_whisper, ctranslate2, torch, transformers, sentencepiece, av, onnxruntime`
- [x] (f) Decode audio ✅: `ffmpeg_read(video.mp4)` chạy tốt trên **cả embeddable và `.venv`**
      (kết quả giống hệt: 279359 samples) → subprocess gọi ffmpeg OK, audio pipeline OK

**Chưa làm / lần sau làm nốt:**

- [ ] **(g) Chạy `transcribe.py` đầy đủ 2-pass với `video.mp4`** (không phải clip) rồi đối
      chiếu output với `.venv` — đây là nốt cuối của cổng quyết định B1
      - Lệnh (đã test đúng cấu hình 1 lần, chỉ chưa chạy với `video.mp4`):
        ```powershell
        $env:PYTHONIOENCODING='utf-8'
        .work\runtimes\python\python.exe scripts\transcribe.py video.mp4 `
          --out .work\runtimes\spike-out.json --language auto
        ```
      - Kỳ vọng: language detect → text pass (PhoASR, lấy từ HF cache) → timing pass
        (`models/BuzzASR-vietnamese` sẵn có) → file JSON ra, exit 0
- [ ] **(h) Test `translate.py`** (dùng transformers, rủi ro thấp nhưng nên chạy 1 lần)

Kiến thức rút ra từ spike (đừng quên):

1. **Lỗi lúc đầu KHÔNG phải do embeddable** — clip test `clip8s.mp4` (ffmpeg `-t 8 -c copy`)
   bị `transformers.ffmpeg_read` từ chối, và **`.venv` cũng fail y hệt với clip đó** → clip
   là thủ phạm. Dùng `video.mp4` gốc thì OK cả hai môi trường.
2. Cảnh báo **`language detection failed ('float' object is not subscriptable)` → fallback 'vi'**
   xuất hiện ở lần chạy embeddable — cần chạy lại với `.venv` để xem có phải bug có sẵn
   (`transcribe.py` ~dòng 55-63, `detect_language`) hay không. Nếu cả hai đều fail thì là
   bug cũ, sửa riêng (không chặn portable).
3. `PYTHONIOENCODING=utf-8` vẫn cần khi chạy tay.
4. Runtime cache: `.work/runtimes/` = **1.024MB** (python embed + 43 gói + clip + get-pip) —
   gitignored, giữ lại để lần sau build tiếp chỉ mất vài phút.

### B2. Bỏ hẳn ffmpeg (45') — chưa làm

- [ ] `lib/probe.mjs` (mới): `@remotion/media-parser` đọc
      `dimensions/fps/durationInSeconds/audioCodec/containerFormat` + `fs.stat` (size) +
      bitRate tự tính → **fallback `ffprobe`** nếu máy có → cả hai fail: lỗi tiếng Việt
- [ ] `server/probe.js` re-export từ `lib/probe.mjs`; `cli.mjs:173` dùng chung `probeVideo`
- [ ] Test: probe `mp4/webm/mov/mkv` (ffmpeg tạo mẫu) · PATH **không** có ffprobe · file hỏng
- [ ] Health: thêm `node` version, browser thật (`getBrowserExecutable()` — hiện
      `REMOTION_BROWSER` echo env là hiểu nhầm), model cache; ffprobe → **tùy chọn**

### B3. `scripts/build-portable.mjs` (1.5h) — chưa làm

- [ ] `npm run build` → staging allow-list (code, `web/dist`, `public/`, `video.mp4`,
      `video.srt`, lock) → `npm ci --omit=dev`
- [ ] Copy runtime từ `.work/runtimes/` (đã có sẵn!) — đừng tải lại; script nên tự tải
      nếu cache thiếu (URL: python.org embed zip + bootstrap.pypa.io/get-pip.py)
- [ ] Bake pip vào `runtime\python` · sinh `start.cmd` + `README.txt`
- [ ] `start.cmd`: set `PYTHON=%~dp0runtime\python\python.exe` (`env.js:13` **hỗ trợ sẵn**
      `process.env.PYTHON`, không sửa server) → `runtime\node\node.exe server\index.js`
      (1 port 4174, serve `web/dist`) → mở trình duyệt
- [ ] Nén `tar.exe -a -cf` → `release/sub-tool-win64-1.0.0.zip` (~1.2GB)
- [ ] Tải Node portable `node-v22*-win-x64.zip` khi build (cache trong `.work/runtimes/`)

### B4. Verify E2E — đúng kịch bản máy bạn tôi (1h) — chưa làm

- [ ] Giải nén zip vào `%TEMP%` → `start.cmd` → 4174 (nếu dev đang chiếm 4174 thì set `PORT` khác lúc test)
- [ ] Health xanh: Python từ `runtime\`, browser Edge/Chrome, **không cần ffprobe**
- [ ] Full flow: upload → Language → **Transcribe tải model ~3GB thật** → Review → Save →
      Style (kể cả upload font) → Render → `video_subbed.mp4`
- [ ] Soi zip: không `.venv/`, `storage/`, `.work/`, rác QA
- [ ] Nguồn: `typecheck` ✅ `build` ✅ `doctor` ✅ · dọn `%TEMP%` (~4GB)

### B5. Commit cuối + báo cáo — chưa làm

- [ ] Commit: `feat: gói portable zero-install + bỏ phụ thuộc ffprobe`
- [ ] Báo user: đường dẫn zip, dung lượng, cách gửi, cách rebuild

---

## Rủi ro & Plan B

| Rủi ro | Xử lý |
|---|---|
| B1(g) fail (2-pass không chạy trên embeddable) | Dừng → user chọn: (a) giữ prereq Python + `npm run setup`, (b) Docker |
| pip resolve transitive lệch `.venv` | E2E B4 bắt; pin thêm gói nếu cần |
| media-parser chưa đọc container lạ | fallback `ffprobe` + lỗi tiếng Việt |
| allow-list thiếu file | E2E từ zip lộ ngay → bổ sung |
| Không có browser ở máy bạn tôi | Edge đã detect sẵn (mọi máy Win) → fallback Remotion tự tải |

## Tiêu chí hoàn thành (Definition of Done) — Phase B
1. `release/sub-tool-win64-1.0.0.zip` tồn tại, ~1.2GB
2. E2E từ zip chạy đủ flow ra `video_subbed.mp4` trên `%TEMP%` sạch
3. Commit cuối + user biết cách gửi / cách rebuild

---

## Phase C — Clone & setup 1 lệnh ✅ HOÀN TẤT (2026-09-30)

Thay thế Phase B (portable) theo quyết định user. Mục tiêu: `git clone` →
`./setup.sh` (Windows: `setup.cmd`) → `npm run dev`.

- [x] **C1. `lib/probe.mjs`** — metadata video bằng `@remotion/media-parser`
      (`dimensions/durationInSeconds/fps/slowFps/audioCodec/container/videoCodec`
      + `fs.stat` cho size, bitRate tự tính), fallback `ffprobe`, lỗi tiếng Việt
      khi cả hai fail. `@remotion/media-parser` nâng thành dep trực tiếp.
      Verify: mp4/webm/mov/mkv đọc đúng (webm/mkv cần `slowFps` vì header
      không lưu fps — `fps` field trả null); file hỏng báo lỗi đúng; chạy
      khi PATH không có ffprobe vẫn OK.
- [x] **C2. `server/probe.js`** re-export `lib/probe.mjs`; `cli.mjs` bỏ
      `ffprobe -version` cứng, dùng chung `probeVideo` (giờ là async);
      `server/index.js` health thêm `node`, ffprobe ghi rõ tùy chọn.
- [x] **C3. `scripts/prefetch-models.py`** — tải sẵn model AI bằng cách gọi
      lại đúng `resolve_local_model()` của `transcribe.py` (text pass
      `Qualcomm-AI-Research/PhoASR-whisper-small` + timing `BuzzASR/vietnamese`).
      Model bản dịch `Helsinki-NLP/opus-mt-*` giữ lazy theo cặp ngôn ngữ.
- [x] **C4. `scripts/setup.mjs`** — thêm bước prefetch model (mặc định,
      `--skip-model` để bỏ qua); skip `pip install` khi env đã OK (lần 2
      chạy < 1s); model fail → warn không block; dòng ffprobe trong checklist
      thành tùy chọn.
- [x] **C5. `setup.sh` + `setup.cmd`** ở root — tự kiểm Node, báo đúng lệnh cài
      (`nvm install 20` / `winget install OpenJS.NodeJS.LTS`) khi thiếu, rồi
      chạy `node scripts/setup.mjs`.
- [x] **C6. Tài liệu** — README mục A → "Clone & cài 1 lệnh" (bỏ mục portable),
      prereq còn Node + Python, ffmpeg tùy chọn; CLONE.md cập nhật; Phase B
      đánh dấu hủy.
- [x] **C7. Verify Ubuntu** — `rm -rf node_modules .venv && ./setup.sh` sạch
      (npm + venv + pip + model + checklist) ✅ · probe 4 định dạng ✅ ·
      `npm run typecheck` ✅ · `npm run build` ✅ · `node scripts/qa-ui.mjs` ✅.

**Chưa verify:** `setup.cmd` trên Windows thật (không có máy Windows ở đây) —
cần chạy 1 lần trên máy bạn tôi.
