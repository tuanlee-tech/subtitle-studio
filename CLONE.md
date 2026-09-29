# Hướng dẫn clone sang máy mới

> Mục tiêu: từ máy trống → chạy được dashboard ở `http://localhost:5173`.
> Thời gian ước tính: ~10 phút cài công cụ + ~15 phút tải (npm/pip) + ~3GB tải model lúc bấm Transcribe.

## 0. Máy cũ (trước khi đổi máy)

Repo hiện **chưa push** (3 commit local, `origin/main` chưa tồn tại):

```bash
git push -u origin main
```

## 1. Cài sẵn trên máy mới

| Phần | Yêu cầu | Tải |
|---|---|---|
| Git | bất kỳ bản nào | https://git-scm.com/download/win |
| Node.js | **≥ 20** (LTS là đủ) | https://nodejs.org |
| Python | **3.10 – 3.12** (3.12 như máy cũ), tick **Add python.exe to PATH** | https://www.python.org/downloads/ |

- Mạng ổn định (lần đầu tải: npm ~750MB, pip ~2-3GB, model ~3GB).
- **Không cần**: Docker, ffmpeg, Chrome, Visual Studio — tất cả đều tùy chọn hoặc tự tải.

## 2. Clone

```bash
# HTTPS (đơn giản nhất — clone xong không cần cấu hình gì thêm)
git clone https://github.com/tuanlee-tech/subtitle-studio.git
cd subtitle-studio
```

Nếu repo **private** hoặc muốn dùng SSH (như remote `git@github.com:...` trên máy cũ):
cần tạo SSH key + thêm vào GitHub (`ssh-keygen -t ed25519` → copy `id_ed25519.pub` vào
GitHub → Settings → SSH keys), rồi clone bằng:

```bash
git clone git@github.com:tuanlee-tech/subtitle-studio.git
```

## 3. Cài dependencies + môi trường (1 lệnh)

```bash
npm run setup
```

Lệnh này tự làm đủ (chạy được cả khi `node_modules` chưa có):

1. `npm install` → dependencies Node;
2. tìm Python 3.10–3.12 → tạo `.venv`;
3. `pip install -r requirements.txt` (torch CPU, faster-whisper, transformers…);
4. in checklist: Node / Python / ffprobe / browser / model / node_modules.

Dòng cuối phải là `Sẵn sàng. Chạy tiếp:` — nếu có dấu `[!!]`, làm theo gợi ý ngay dòng đó, hoặc chạy lại `npm run doctor`.

## 4. Chạy

```bash
npm run dev
```

Mở **http://localhost:5173** → dùng 7 bước như bình thường.
Dừng: Ctrl+C (đóng hẳn process, đừng để dồn port — xem mục Lỗi thường gặp).

## 5. Lần chạy đầu trên máy mới

| Việc | Chi tiết |
|---|---|
| Bấm **Transcribe** lần đầu | Tải model ~3GB (PhoASR + BuzzASR) → lưu vào cache HuggingFace + `models/` — **1 lần duy nhất**, lần sau chạy ngay |
| Bấm **Render** lần đầu | Chưa cài Chrome/Edge thì Remotion tự tải headless shell (cần mạng) |
| Bước Upload báo thiếu ffprobe | Vẫn chạy được (app tự đọc bằng thư viện trong nước); muốn có thì `winget install Gyan.FFmpeg` |
| `storage/` | Tự tạo khi server khởi động — không có trong repo |

## 6. Kiểm tra mọi lúc

```bash
npm run doctor        # checklist môi trường, không cài gì
npm run typecheck     # TypeScript
npm run build         # vite build (bắt buộc trước khi npm start)
```

Chế độ production (1 port, không cần Vite):

```bash
npm run build && npm start     # → http://localhost:4174
```

## 7. Lỗi thường gặp

Xem bảng đầy đủ ở [README.md](README.md) (mục "Lỗi thường gặp"). Thường gặp nhất trên máy mới:

| Triệu chứng | Cách xử lý |
|---|---|
| `Không tìm thấy Python 3.10-3.12` | Cài Python 3.12, tick Add to PATH, mở lại terminal |
| `pip install thất bại` ở torch | Giữ nguyên dòng `--extra-index-url .../whl/cpu` trong `requirements.txt` |
| Health `ok:false` ở Transcribe | `.venv` gãy → chạy lại `npm run setup` |
| Port 5173/4174 đã dùng | `netstat -ano | findstr :5173` rồi `taskkill /PID <pid> /F` |

## Ghi chú

- Code đã tách `storage/`, `models/`, `.venv/`, `node_modules/` khỏi git → clone về là rỗng, phần này máy tự dựng lại.
- Muốn kéo code mới trên máy mới: `git pull`.
- Chi tiết kế hoạch/dự án: [PLAN.md](PLAN.md).
