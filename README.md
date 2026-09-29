# Subtitle Studio (sub-tool)

Công cụ tạo phụ đề video chạy hoàn toàn trên máy local — không gửi video đi đâu:

**Upload video → nhận diện ngôn ngữ → Transcribe 2 pass (PhoASR viết đúng chính tả + BuzzASR lấy timing từng từ) → hiệu chỉnh phụ đề → dịch máy (tùy chọn) → lưu `.srt` → chỉnh style → render burn-in word-by-word bằng Remotion.**

![Giao diện](ui-workflow.png)

---

## A. Dùng ngay — không cần cài gì

> Yêu cầu duy nhất: **Windows 64-bit**. Không cần Node, Python, ffmpeg, Chrome, không mở terminal.

1. Tải `sub-tool-win64-<phiên bản>.zip` (~1.2GB)
2. Giải nén vào bất kỳ thư mục nào (vd: `C:\sub-tool`)
3. Bấm đúp **`start.cmd`** → trình duyệt tự mở `http://localhost:4174`
4. Dùng 7 bước như bình thường

**Ghi chú:**

| Việc | Chi tiết |
|---|---|
| Lần đầu bấm **Transcribe** | Tải model AI ~3GB (một lần duy nhất, cần mạng) — xem cột `models/` |
| Chưa cài Chrome/Edge | Remotion tự tải headless shell lúc render lần đầu (cần mạng) |
| Chưa cài ffprobe/ffmpeg | **Không cần** — bản portable đã bỏ qua bước này |
| Muốn dừng app | Đóng cửa sổ console do `start.cmd` mở ra |
| Dữ liệu của bạn | Nằm trong `storage/` ngay trong thư mục giải nén |

---

## B. Phát triển (dev)

> Clone sang máy mới? Làm theo **[CLONE.md](CLONE.md)** (có bước push/clone + checklist lần đầu).

### Yêu cầu hệ thống

- **Node.js ≥ 20** (bắt buộc)
- **Python 3.10 – 3.12** (bắt buộc)
- ffprobe/ffmpeg trong PATH — **tùy chọn**: metadata lúc Upload (nếu thiếu, app tự đọc bằng thư viện trong nước)
- Chrome/Edge — cho render *(tùy chọn: không có thì Remotion tự tải)*

### Cài đặt & chạy

```bash
npm install          # dependencies Node (~750MB)
npm run setup        # tạo .venv + cài 5 gói Python + kiểm tra môi trường
npm run dev          # → http://localhost:5173  (UI, mở URL này)
```

Kiểm tra môi trường bất cứ lúc nào (không cài gì):

```bash
npm run doctor
```

### Chế độ production (1 port duy nhất)

```bash
npm run build        # build web → web/dist
npm start            # → http://localhost:4174  (server tự serve web/dist)
```

### Gói portable (gửi cho người khác)

```bash
npm run build-portable    # → release/sub-tool-win64-<ver>.zip (~1.2GB)
```

Gói chứa sẵn runtime Node + Python embeddable + toàn bộ thư viện → người nhận
chỉ cần giải nén và bấm `start.cmd`. Rebuild được mỗi lần sửa code.

### CLI (không qua giao diện)

```bash
npm run sub -- video.mp4                  # detect ngôn ngữ → transcribe → render
npm run sub -- video.mp4 --lang vi --yes  # bỏ qua bước hỏi
```

### Kiểm thử

```bash
npm run typecheck    # TypeScript
npm run build        # vite build
npm run doctor       # checklist môi trường
node scripts/qa-ui.mjs      # test UI qua Chrome headless (cần Chrome + server đang chạy)
node scripts/qa-guide.mjs   # test tour hướng dẫn
```

### Cấu trúc thư mục

| Đường dẫn | Nội dung |
|---|---|
| `server/` | API Express (4174): upload, transcribe, translate, render, fonts |
| `web/` | React UI (7 bước) — build ra `web/dist` |
| `src/` + `lib/` | Dựng hình Remotion (composition burn-in, layout, style) |
| `scripts/` | pipeline Python (transcribe/translate/detect), setup, QA, pack |
| `public/` | Font Baloo2 + font người dùng tải lên |
| `models/` | CT2 model đã convert (tự tạo khi chạy lần đầu) |
| `storage/` | Job của bạn: video, transcript, srt, output |
| `.venv/` | Môi trường Python (tự tạo bởi `npm run setup`) |

### Lỗi thường gặp

| Triệu chứng | Cách xử lý |
|---|---|
| Health `ok:false`, lỗi Python ở bước Transcribe | `.venv` thiếu/gãy → `npm run setup` |
| "Không tìm thấy ffprobe" ở bước Upload | `winget install Gyan.FFmpeg` (bản dev) — bản portable không cần |
| Transcribe lần đầu rất chậm | Đang tải model ~3GB vào `models/` + cache HuggingFace |
| Render báo thiếu browser | Để trống — Remotion tự tải, hoặc cài Chrome/Edge |
| `pip` fail khi cài `torch==...+cpu` | Đừng xóa dòng `--extra-index-url .../whl/cpu` trong `requirements.txt` |
| Port 4174/5173 đã được dùng | Đóng instance `npm run dev` đang chạy trước đó |
