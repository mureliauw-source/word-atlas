<div align="center">

<a href="https://mure.iepose.cn/"><img src="docs/assets/cover-v2.jpg" alt="词光 Word Atlas — 一词一画，点亮雅思" width="100%"></a>

# 词光 · Word Atlas · 私享版

**把单词变成画面，让复习有迹可循。**

7,298 个雅思词条 · 原创插画 · 英美发音 · FSRS 间隔复习

[**立即体验 ↗**](https://mure.iepose.cn/) / [48 秒介绍](docs/assets/launch.mp4) / [下载词库](data/) / [English](README.en.md)

[![Code: MIT](https://img.shields.io/badge/Code-MIT-17283B?style=flat-square)](LICENSE)
[![Dataset: CC BY 4.0](https://img.shields.io/badge/Dataset-CC_BY_4.0-AD5038?style=flat-square)](CONTENT_LICENSE.md)
[![Follow on X](https://img.shields.io/badge/X-@yangleiocx3-17283B?style=flat-square&logo=x&logoColor=white)](https://x.com/yangleiocx3)

</div>

---

词光是一款以插画和语境为核心的雅思背词应用。看画面理解词义，听发音建立联系，再用主动回忆和间隔复习巩固记忆。游客可直接使用；注册账号后，可手动保存进度并在其他设备读取。

> **私享版说明**：本仓库基于 [designfuchen/word-atlas](https://github.com/designfuchen/word-atlas) 改造。截至 2026-10-28，已加入公开注册、账号登录、SQLite 存储及手动保存，配套前后端已部署到飞牛 NAS。原项目署名和 MIT / CC BY 4.0 授权继续保留。

> **特效说明**：单词星图有旋转动效。移动端默认能够正常显示，如果电脑端无法展示，可以在 "**Windows 设置 → 辅助功能 → 视觉效果 → 动画效果 → 点击开启动画**" ，然后刷新网站，enjoy！

[产品预览](#产品预览) · [学习方式](#学习方式) · [本地运行](#本地运行) · [开放数据](#开放数据) · [参与贡献](#参与贡献)

## 私享版的变化

- **公开注册**：游客可直接注册，无需 NAS 管理账号。账号之间分别保存数据。
- **手动保存**：答题、收藏、打字练习和学习设置先保存为浏览器草稿。点击“我的 → 账号与同步 → 保存到账号”，才整体提交。
- **多设备使用**：另一设备登录后读取已保存的进度，也可点击“读取账号进度”。没有定时自动上传或后台轮询。
- **失败与冲突处理**：保存失败保留草稿；重试复用操作编号。另一设备已有新版本时拒绝覆盖，保留本机数据。
- **兼容原备份**：保留版本 2 JSON 导入、导出。导入账号进度后，仍需手动保存。
- **界面修复**：兼容普通 HTTP 下的操作编号生成；移除常驻同步浮层；提高答题反馈浮窗不透明度并增加背景模糊；修复听写“再听一遍”被透明输入框遮挡的问题。
- **自托管**：前端使用 Nginx，账号 API 使用 Node.js 22，账号数据保存到持久化 SQLite。提供 [Docker Compose 示例](deploy/compose.yaml)。

## 账号与保存

1. 在“我的”中注册或登录。登录不会覆盖原有游客数据。
2. 学习和修改设置时，草稿立即写入当前浏览器。
3. 结束学习后，点击“保存到账号”，等待“已保存到账号”提示。
4. 换设备后登录同一账号，或点击“读取账号进度”。

主题、自动播放和环境声等偏好保留在当前设备。登录和手动保存需要联网，已加载的词条和媒体可缓存使用。

未提交的草稿只存在当前浏览器，清理站点数据会将其删除。导出备份包含当前草稿；读取账号进度前如有未保存修改，界面会要求确认。发生版本冲突时，应先导出本机备份，再决定读取账号版本或重新导入后保存。

当前开放注册，暂不提供自助密码找回。请妥善保管密码；本实例管理员邮箱为 [mure@qq.com](mailto:mure@qq.com)。

## 产品预览

### 一本可以听、可以练的单词图鉴

<img src="docs/assets/atlas-desktop.jpg" alt="开源版桌面图鉴：插画词卡和词汇浏览" width="100%">

<table>
<tr>
<td width="50%"><img src="docs/assets/today-mobile.jpg" alt="手机端今日学习页" width="100%"></td>
<td width="50%"><img src="docs/assets/word-mobile.jpg" alt="手机端词卡，展示插画、英美发音与例句" width="100%"></td>
</tr>
<tr><td align="center">每日计划，把注意力放在今天</td><td align="center">插画、词义、发音，在一张词卡里</td></tr>
</table>

<sub>以上为原项目截图，用于展示核心学习界面。本私享版的账号与保存流程已有调整。页首为品牌概念插画。</sub>

### 学过的词，汇成自己的星图

<img src="docs/assets/galaxy.jpg" alt="词汇星图界面：按话题组织单词，展示学习进度" width="100%">

19 个话题组成词汇星图。拖动旋转、滚动缩放，点击星星打开词卡；学习状态用不同亮度呈现。采用 WebGL2 渲染，不支持的设备提供降级显示。

<details>
<summary><b>看 48 秒宣传片</b></summary>

<a href="docs/assets/launch.mp4"><img src="docs/assets/launch-preview.webp" alt="点击观看词光宣传片" width="100%"></a>

[播放完整视频（含声音）](docs/assets/launch.mp4)

</details>

## 学习方式

| 环节     | 你会做什么                                                           |
| :------- | :------------------------------------------------------------------- |
| **看见** | 每个词配一幅插画、中英释义、两条原创例句，以及搭配、词族和用法提示。 |
| **听见** | 切换英音、美音，听日常例句朗读；部分词条另含第二条例句录音。         |
| **想起** | 看义选词、看图补句、听音辨词、拼写，逐步练习主动回忆。               |
| **复习** | FSRS 根据学习记录安排复习，目标记忆率可调。只有首次作答计入正确率。  |
| **积累** | 星图展示学习进度；打字练习独立统计；支持导出和恢复本地进度。         |

**本地优先。** 游客数据保存在本机；账号草稿也先保存在本机，手动提交后才供其他设备读取。原有导入、导出始终保留。

### 学习快捷键

| 按键 | 功能 |
| --- | --- |
| `1`–`4` | 选择对应答案。 |
| `Enter` | 确认答案或继续学习。 |
| `Space` | 在部分看词和作答时，播放单词发音。 |

空格播放使用当前选择的英式或美式发音，以正常语速播放。
拼写题和看图补句题不增加空格播放功能。
显示答题结果后，空格保留原有的继续功能。

<details>
<summary><b>听发音、例句与环境声样本</b></summary>

拿 _abandon_ 举例，点开就能听（在线播放）：

|             |                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------- |
| 🇬🇧 英音     | [abandon /əˈbændən/](https://mure.iepose.cn/atlas/audio/uk/abandon.mp3)                     |
| 🇺🇸 美音     | [abandon /əˈbændən/](https://mure.iepose.cn/atlas/audio/us/abandon.mp3)                     |
| 📖 例句朗读 | [We had to abandon our car in the snow.](https://mure.iepose.cn/atlas/audio/ex/abandon.mp3) |

全部 7,298 个词都有英音、美音和例句朗读，还有 1,011 个重点词的第二条例句也配了朗读。

### 环境声与交互声音

|                  |                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🎙 **开屏配音**   | [「欢迎打开雅思大门」](https://mure.iepose.cn/sfx/splash-voice.mp3)：星尘汇聚成“词光”，大门打开                                                                                                                                                                                                                                          |
| 🌌 **星图配音**  | [「这是你的词汇星图。每学会一个词，就点亮一颗星。」](https://mure.iepose.cn/sfx/voice-galaxy-hello.mp3)                                                                                                                                                                                                                                  |
| 🎵 **星空音乐**  | [一段可无缝循环的原创配乐](https://mure.iepose.cn/sfx/amb-stars.mp3)，默认陪你背词                                                                                                                                                                                                                                                       |
| 🌧 **6 段环境声** | [雨天图书馆](https://mure.iepose.cn/sfx/amb-rain.mp3) · [清晨海岸](https://mure.iepose.cn/sfx/amb-sea.mp3) · [林间早晨](https://mure.iepose.cn/sfx/amb-forest.mp3) · [夜晚壁炉](https://mure.iepose.cn/sfx/amb-fire.mp3) · [远航船舱](https://mure.iepose.cn/sfx/amb-voyage.mp3) · [安静咖啡馆](https://mure.iepose.cn/sfx/amb-cafe.mp3) |
| ✨ **界面音效**  | 答对、答错、翻卡、打字、连胜、点亮星星……每个操作都有自己的声音；读单词时背景音会自动压低                                                                                                                                                                                                                                                 |

全部素材都在仓库里：插画在 `public/atlas/img/`，录音在 `public/atlas/audio/`，这两类按 CC BY 4.0 开放；界面声音和配乐在 `public/sfx/`，随应用一起提供。

</details>

## 本地运行

需要 **Node.js 22.13+** 和 npm，建议使用最新的 Node.js 22 补丁版本。账号 API 使用内置 `node:sqlite`，Node.js 20 无法运行。仓库含完整图片与录音，首次下载可能较久。

```bash
git clone --depth 1 https://github.com/mureliauw-source/word-atlas.git
cd word-atlas
npm ci
```

打开两个终端，在项目根目录分别运行：

```bash
npm run api   # 终端 1：账号 API，默认 127.0.0.1:3001
npm run dev   # 终端 2：网页，默认 127.0.0.1:5188
```

打开 **http://127.0.0.1:5188**。Vite 将 `/api/` 转发到本机账号 API。
默认只监听本机。局域网访问需另外配置监听地址及 `ALLOWED_ORIGINS`。
本地账号数据库默认位于 `.data/word-atlas.sqlite`，已加入 Git 忽略规则。

```bash
npm test             # 前端与草稿状态测试
npm run test:server  # 注册、登录、整批保存与冲突测试
npm run check:server # API 类型检查
npm run check:atlas  # 词库结构与媒体校验
npm run build        # 构建到 dist/
npm run build:server # 打包账号 API 到 dist-server/server.mjs
```

## 部署到 NAS / Docker

先生成前端和 API 构建文件，再启动示例服务：

```bash
npm run build
npm run build:server
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env，填写实际访问地址的 ALLOWED_ORIGINS
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

默认网页端口为 `18088`。账号数据库持久化到 `deploy/data/`，不要随代码更新删除。
Windows PowerShell 可用 `Copy-Item deploy/.env.example deploy/.env` 复制配置。
完整的来源校验、反向代理、升级备份及回退步骤见 [部署文档](docs/deployment.md)。

单独把 `dist/` 发布到 Cloudflare Pages 或 GitHub Pages 只能使用游客功能。
账号注册、登录和保存必须配套 Node.js API，并通过同域 `/api/` 访问。

**技术栈**：React 19 · TypeScript · Vite · ts-fsrs · WebGL2 · Node.js 22 · SQLite

## 开放数据

不仅可以直接使用应用，也可以把词库用于自己的学习工具、Anki 牌组或研究项目。

| 资源 | 开源版内容                                | 入口                                                      |
| :--- | :---------------------------------------- | :-------------------------------------------------------- |
| 词条 | **7,298** 条，CEFR A1–C2、19 个话题       | [JSON](data/word-atlas.json) · [CSV](data/word-atlas.csv) |
| 例句 | **14,596** 条，日常与雅思语境，附中文翻译 | [字段说明](docs/dataset.md)                               |
| 插画 | **7,298** 幅，512 px WebP，另有缩略图     | [图片目录](public/atlas/img/)                             |
| 录音 | **22,905** 段，英音、美音与例句朗读       | [音频目录](public/atlas/audio/)                           |

```python
import json
from pathlib import Path

words = json.loads(Path("data/word-atlas.json").read_text(encoding="utf-8"))
b2_environment = [w for w in words if w["cefr"] == "B2" and w["topic"] == "environment"]
```

<details>
<summary><b>查看一条词条的数据结构</b></summary>

```json
{
  "id": "principle",
  "w": "principle",
  "uk": "/ˈprɪnsəpəl/",
  "us": "/ˈprɪnsəpəl/",
  "senses": [
    {
      "pos": "n.",
      "zh": "原则；行为准则",
      "en": "A belief or rule that guides decisions and behaviour."
    }
  ],
  "ex": [
    {
      "en": "I refused the extra money as a matter of principle.",
      "zh": "出于原则，我拒绝了那笔额外的钱。"
    },
    {
      "en": "The principle of equal opportunity should guide policies designed to improve access to higher education.",
      "zh": "…"
    }
  ],
  "col": ["in principle｜原则上", "basic principle｜基本原则"],
  "fam": ["principled (adj.)"],
  "tip": "principle 是原则；principal 是校长、主要的。",
  "cefr": "B2",
  "topic": "thinking"
}
```

</details>

### 内容来源与局限

释义、例句、插画和录音为本项目生成：文字与插画使用生成式 AI，语音使用 ElevenLabs。内容经过自动结构与一致性校验，**尚未逐条人工审校**，可能出现释义、例句、插画或发音错误。它不是官方雅思词表，也不承诺提分。

[内容生成流程](docs/pipeline.md) · [记忆模型](docs/learning-model.md) · [生成脚本](scripts/atlas/)

## 参与贡献

发现问题时，请附上**词条 ID、复现步骤和预期结果**。内容纠错如有词典或其他可靠依据，也请一并提供。

- [报告问题](https://github.com/mureliauw-source/word-atlas/issues/new/choose)：词条纠错、界面问题或使用建议。
- [贡献指南](CONTRIBUTING.md)：数据同步、代码规范和提交前检查。
- [安全政策](SECURITY.md)：安全问题的反馈方式。

## 授权

| 范围                     | 许可                                                                  |
| :----------------------- | :-------------------------------------------------------------------- |
| 应用代码                 | [MIT](LICENSE)                                                        |
| 词库文本、插画与词条录音 | [CC BY 4.0](CONTENT_LICENSE.md)，署名 Word Atlas contributors（词光） |
| 第三方依赖与字体         | 遵循各自许可，详见相应文件                                            |

---

本版本由 [@mureliauw-source](https://github.com/mureliauw-source) 进行维护，并增加：

1. 增加账号管理、手动保存与自托管相关改造；
2. 同步支持云端进度存储；
3. 修正了原项目中的多个 bug 缺陷。

原项目由 [@designfuchen](https://github.com/designfuchen) 制作。原作者动态见 [X · @yangleiocx3](https://x.com/yangleiocx3)。

如果词光对你有用，欢迎 Star，或把它分享给正在学英语的朋友。
