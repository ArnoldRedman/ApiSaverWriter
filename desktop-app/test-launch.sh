#!/bin/bash

APP_PATH="./src-tauri/target/release/bundle/macos/ApiSaverWriter.app"

echo "Testing ApiSaverWriter launch..."

if [ ! -d "$APP_PATH" ]; then
    echo "Error: App not found at $APP_PATH"
    exit 1
fi

echo "Starting app in background..."
"$APP_PATH/Contents/MacOS/apisaverwriter" > /tmp/apisaverwriter-test.log 2>&1 &
APP_PID=$!

echo "App started with PID: $APP_PID"
sleep 3

if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ App is running successfully!"
    echo "Stopping test app..."
    kill $APP_PID
    wait $APP_PID 2>/dev/null
    echo "✅ Test passed!"
    exit 0
else
    echo "❌ App crashed or exited"
    echo "Log output:"
    cat /tmp/apisaverwriter-test.log
    exit 1
fi
