# 移动端构建

本项目使用同一份 React 前端和 Tauri Rust 数据层构建 Windows、macOS、Android、iOS。

## 移动端 Agent

Android 与 iOS 不启动桌面 Node 子进程，直接通过 Tauri 原生 HTTP 通道访问“AI 模型配置”里的 OpenAI/Responses/Anthropic 兼容接口。模型密钥只保存在本机，移动端不需要填写 Gateway，也不需要额外服务器。章节、章纲、卡片和润色请求保持 SSE 流式返回；本地项目、记忆和用量仍由 Tauri 数据层保存。

如果接口没有浏览器 CORS 头，应用会自动使用内置的 `tauri-plugin-http` 原生请求通道；桌面端仍使用内置 Agent Runtime。

## 初始化与构建

Android 需要 Android SDK、NDK、JDK，并设置 `ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）。

```bash
cd desktop-app
npm run mobile:init -- android
npm run android:build
```

iOS 需要 Xcode、CocoaPods、Apple Development Team：

```bash
cd desktop-app
APPLE_DEVELOPMENT_TEAM=YOUR_TEAM_ID npm run mobile:init -- ios
APPLE_DEVELOPMENT_TEAM=YOUR_TEAM_ID npm run ios:build
```

桌面构建保持不变：`npm run tauri:build`。Windows 安装包需要在 Windows CI 或 Windows 机器上构建；macOS 不能直接产出可发布的 Windows WebView2 安装包。
