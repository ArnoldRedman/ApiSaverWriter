# 贡献指南

感谢你参与 ApiSaverWriter 的改进。

## 提交前

1. 从 `main` 拉取最新代码并建立独立分支。
2. 保持改动聚焦，说明影响的写作流程和平台。
3. 运行与改动相关的检查，例如：

```bash
npm test
npm run typecheck
npm --prefix desktop-app run build
```

4. 为行为变更补充或更新测试；UI 变更请同时检查桌面与移动端布局。

## Pull Request

- 标题应描述用户可见的结果。
- 说明问题、实现方式、验证命令与结果。
- 不要提交 `node_modules`、构建目录、安装包、个人作品、云端备份或本地数据库。
- 不要提交 API Key、Cookie、访问令牌、签名证书、日志中的认证头或截图中的敏感数据。

## Issue

Bug 报告请包含复现步骤、预期行为、实际行为、系统版本和应用版本。安全问题请不要公开提交 Issue，改用 [安全策略](SECURITY.md) 中的渠道。
