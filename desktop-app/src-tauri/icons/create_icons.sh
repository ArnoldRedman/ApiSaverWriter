#!/usr/bin/env bash
set -euo pipefail

# 织章全套图标的唯一生成入口。品牌母图是 branding/zhizhang-brand.png（1024×1024），
# 打包图标、favicon 和界面里的品牌标识都由它派生，改品牌图后重跑本脚本即可全部对齐。
# 依赖 @tauri-apps/cli，需要先在 desktop-app 下装好依赖。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# 生成桌面、Windows 磁贴、Android、iOS 全套尺寸；iOS 不支持透明底，补上书页主题的面板色。
npx tauri icon branding/zhizhang-brand.png \
  -o src-tauri/icons \
  --ios-color '#F4F5F2'

# Tauri 约定的应用图标源图
cp branding/zhizhang-brand.png app-icon.png

# 界面里的品牌标识最大只显示到 64px（启动页），256px 足够覆盖 4 倍屏，
# 直接搬 1024 的母图会白白给安装包压进 1.7MB。
cp src-tauri/icons/128x128@2x.png public/zhizhang-brand.png
cp src-tauri/icons/128x128.png public/favicon.png

printf '已从 branding/zhizhang-brand.png 生成织章全套图标\n'
