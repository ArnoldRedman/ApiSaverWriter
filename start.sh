#!/bin/bash

# 织章快速启动脚本

echo "🚀 织章 - AI 小说写作工作台"
echo "=================================="
echo ""

# 检查依赖
check_dependencies() {
    echo "📦 检查依赖..."
    
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js 未安装，请先安装 Node.js 18+"
        exit 1
    fi
    
    if ! command -v cargo &> /dev/null; then
        echo "❌ Rust 未安装，请先安装 Rust 1.70+"
        exit 1
    fi
    
    echo "✅ Node.js: $(node --version)"
    echo "✅ Rust: $(cargo --version)"
    echo ""
}

# 安装后端依赖
install_backend() {
    echo "📥 安装后端引擎依赖..."
    cd sidecars/agent-runtime
    
    if [ ! -d "node_modules" ]; then
        npm install
    else
        echo "✅ 后端依赖已存在"
    fi
    
    cd ../..
    echo ""
}

# 安装前端依赖
install_frontend() {
    echo "📥 安装桌面应用依赖..."
    cd desktop-app
    
    if [ ! -d "node_modules" ]; then
        npm install
    else
        echo "✅ 前端依赖已存在"
    fi
    
    cd ..
    echo ""
}

# 运行测试
run_tests() {
    echo "🧪 运行后端测试..."
    cd sidecars/agent-runtime
    npm test
    
    if [ $? -eq 0 ]; then
        echo "✅ 所有测试通过"
    else
        echo "❌ 测试失败，请检查"
        exit 1
    fi
    
    cd ../..
    echo ""
}

# 启动开发服务器
start_dev() {
    echo "🎯 启动开发服务器..."
    echo ""
    echo "即将打开 Tauri 窗口..."
    echo "按 Ctrl+C 停止服务"
    echo ""
    
    cd desktop-app
    npm run dev
}

# 主流程
main() {
    check_dependencies
    
    case "$1" in
        "install")
            install_backend
            install_frontend
            echo "✅ 所有依赖安装完成"
            echo ""
            echo "下一步: 运行 './start.sh dev' 启动开发服务器"
            ;;
        "test")
            run_tests
            ;;
        "dev")
            start_dev
            ;;
        "build")
            echo "📦 构建发布版本..."
            cd desktop-app
            npm run build
            echo ""
            echo "✅ 构建完成！"
            echo "安装包位置: desktop-app/src-tauri/target/release/bundle/"
            ;;
        *)
            echo "用法: ./start.sh [命令]"
            echo ""
            echo "命令:"
            echo "  install  - 安装所有依赖"
            echo "  test     - 运行测试"
            echo "  dev      - 启动开发服务器"
            echo "  build    - 构建发布版本"
            echo ""
            echo "快速开始:"
            echo "  1. ./start.sh install"
            echo "  2. ./start.sh test"
            echo "  3. ./start.sh dev"
            ;;
    esac
}

main "$@"
