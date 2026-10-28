# 安全与隐私 / Security and privacy

## 数据保存

游客进度保存在当前浏览器。注册账号后，学习操作先写入本机草稿；
只有用户点击“保存到账号”才提交完整快照到账号 API。
账号、会话和已提交进度存储在部署者管理的 SQLite 数据库中。
应用没有加入分析或追踪服务。

Guest progress and account drafts are stored in the browser.
Manual saves send the complete snapshot to the self-hosted account API.
The deployment owner manages the SQLite account, session and progress data.
This fork does not add analytics or tracking.

密码使用带随机盐的 scrypt 哈希，原密码不写入数据库。
会话使用随机令牌，数据库保存令牌哈希；浏览器 Cookie 使用 HttpOnly 和 SameSite。
公网部署应使用 HTTPS。允许来源和 Secure Cookie 的设置见
[部署文档](docs/deployment.md)。

手动保存使用版本检查和幂等操作编号，避免多端无提示覆盖及重复提交。
内容按词库校验，账号只能读取和更新自己的数据。
未保存草稿可能因清理站点数据而丢失，请先导出备份。
数据库采用 WAL，运行中不能仅复制主数据库文件作为完整备份。

目前开放注册，暂不提供自助密码找回。
本实例管理员邮箱为 [mure@qq.com](mailto:mure@qq.com)。

## 凭据与发布

网页运行不需要模型 API key。内容生成脚本从环境变量或仓库外目录读取凭据。
不要把凭据放入 VITE_ 前缀变量，这些值会进入前端构建。
数据库、登录会话、.env、生成文件和本地测试输出不得提交到仓库。
仓库内的 deploy/.env.example 仅包含非敏感示例配置。

公开导出脚本按白名单导出并扫描常见凭据格式。
自动扫描只能辅助检查；发布前还应人工审阅提交差异。
如果凭据泄露，应立刻在服务商处吊销或轮换。

## 报告问题

请通过 GitHub 私密漏洞报告或管理员邮箱反馈安全问题。
不要在公开 Issue 中粘贴密码、Cookie、数据库文件或个人学习备份。
