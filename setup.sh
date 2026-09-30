#!/usr/bin/env bash
# Cài đặt Subtitle Studio sau khi clone — chạy: ./setup.sh
# Tương đương `npm run setup` nhưng tự kiểm tra Node trước.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Chưa cài Node.js (>= 20)."
  echo ""
  echo "Ubuntu/Debian:"
  echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  echo "  source ~/.nvm/nvm.sh && nvm install 20"
  echo "hoặc: sudo apt install nodejs npm"
  echo ""
  echo "Sau khi cài xong, chạy lại: ./setup.sh"
  exit 1
fi

node scripts/setup.mjs "$@"
