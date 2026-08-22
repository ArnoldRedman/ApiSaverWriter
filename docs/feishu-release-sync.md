# 飞书 Release 同步

仓库的 `ApiSaverWriter Release` 工作流会在构建完成后，把版本更新内容和所有安装包下载链接追加到飞书版本文档。下载链接来自独立的公开分发仓库，源码仓库保持私有：

`https://my.feishu.cn/wiki/TQKNwxbzUitID3kWxOicv58vnqa`

公开分发仓库：`Vaxue/AI-xiaoshuo-xiezuo-ruanjian`

## GitHub Secrets

在仓库 `Settings -> Secrets and variables -> Actions` 添加：

- `FEISHU_APP_ID`：飞书 CLI 配置生成的 App ID
- `FEISHU_APP_SECRET`：对应 App Secret
- `FEISHU_DOC_URL`：可选，默认使用上面的版本文档地址
- `DISTRIBUTION_GITHUB_TOKEN`：可选但发布公开安装包时必需，需具备公开分发仓库的 `repo` 权限
- `DISTRIBUTION_REPOSITORY`：可选，默认 `Vaxue/AI-xiaoshuo-xiezuo-ruanjian`

工作流只在两个必需 Secret 都存在时执行同步；未配置时仍会正常发布 GitHub Release。

## 本机手动同步

先完成 `lark-cli config init --new` 或 `lark-cli profile add`，再执行：

```bash
RELEASE_TAG=v0.1.2 npm run sync:feishu-release
```

脚本会检查文档中是否已有同版本标题，已存在时跳过，不会重复追加。
