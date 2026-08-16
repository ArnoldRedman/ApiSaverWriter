# 移动端构建

本项目使用同一份 React 前端和 Tauri Rust 数据层构建 Windows、macOS、Android、iOS。

## Agent Gateway

Android 与 iOS 不能运行桌面端内置的 Node 子进程。先在一台可信桌面电脑或服务器启动同仓库 Gateway：

```bash
cd desktop-app
npm run agent:gateway
```

默认监听 `http://127.0.0.1:8787`。部署到局域网或 HTTPS 服务后，在移动端“设置 -> AI 模型配置 -> 移动端 Agent Gateway”填写可访问地址。它转发同一套 RPC、流式进度、缓存和书源逻辑；模型 Key 仍由手机本地设置随请求发送。

生产环境必须将 Gateway 放在 HTTPS 反向代理之后，并限制 `AGENT_GATEWAY_ORIGIN` 与网络访问范围。

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
