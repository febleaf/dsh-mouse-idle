# Windows 鼠标空闲控制 · DeepSeek Harness

这个 Windows 插件让 DeepSeek Harness（DSH）等你用完鼠标，再点击、拖拽、滚动或切换窗口。默认等待 **连续空闲 3 秒**。移动鼠标、按下或松开鼠标按钮、滚动滚轮都会重新计时。按住按钮时，插件会一直等到松开，再等待完整的空闲时间。

## 安装

适用于已解锁的 Windows 桌面，已测试 DSH Desktop `0.2.2-rc.5`。插件通过 GitHub 发布，包名为 `@febleaf/dsh-mouse-idle`。已安装 `v0.1.0` 的用户请先按下方「从旧版迁移」操作。

在 DSH 的「插件」→「添加插件」粘贴以下地址，确认安装 `v0.2.0`。

```text
github:febleaf/dsh-mouse-idle#v0.2.0
```

使用 CLI 时，以下命令会安装到 `web` 配置。

```powershell
dsh plugin --profile web add "github:febleaf/dsh-mouse-idle#v0.2.0"
```

也可以通过「发现」页安装。在「插件」→「实验性插件」开启「自定义插件索引」，进入「发现」→「添加索引源」，粘贴下方地址，搜索「Windows 鼠标空闲控制」并安装。发行包可从 [GitHub Releases](https://github.com/febleaf/dsh-mouse-idle/releases) 下载。

```text
https://raw.githubusercontent.com/febleaf/dsh-mouse-idle/main/market/index.json
```

### 从旧版迁移

`v0.1.0` 使用旧包名 `@local/dsh-mouse-idle`。先记下自定义的空闲秒数，在「插件」中移除旧包，再按上面的地址安装新版。按 DSH 提示重启后，查询空闲状态，核对 `idleMs`。例如，5 秒对应 `5000`。

CLI 用户可在安装前运行以下命令移除同一配置中的旧包。

```powershell
dsh plugin --profile web remove @local/dsh-mouse-idle
```

插件声明的 DSH 兼容范围为 `>=0.2.2-rc.5 <0.3.0-0`。启动时会使用系统的 .NET Framework 4.x C# 编译器（`csc.exe`）在临时目录编译鼠标监视程序。

## 使用示例

**查看状态。** 在 DSH 对话中输入「用 Windows 鼠标空闲工具查看当前设置，还要等多久才能操作？」这会调用 `windows_desktop_inspect`，参数为 `{"action":"status"}`。默认返回的 `idleMs` 为 `3000`。`remainingMs` 表示还需等待的毫秒数，空闲条件已满足时为 `0`。

**滚动前台窗口。** 打开一份可滚动的文档，在 DSH 对话中输入「用 Windows 鼠标空闲工具找到这份文档，确认窗口内容后向下滚动两格。」你可以继续操作鼠标。等鼠标连续空闲，插件才会执行滚动。等待期间点击会话的停止按钮，即可取消待执行的操作。

**把等待时间调到 5 秒。** 打开「插件」→「Windows 鼠标空闲控制」，在「鼠标空闲时间（秒）」中填入 `5` 并保存。再次查询状态，`idleMs` 应为 `5000`。设置也对正在等待的操作生效。「恢复默认」会将阈值恢复为 3 秒。

## 工具与数据

| 工具 | 操作 | 行为 |
| --- | --- | --- |
| `windows_desktop_inspect` | `status`、`list`、`capture` | 查看空闲状态、列出窗口、截取指定窗口。查询与截图均可立即执行。 |
| `windows_desktop_control` | `activate`、`click`、`drag`、`scroll` | 等待鼠标空闲，再执行一次操作。点击、拖拽和滚动要求目标窗口处于前台。 |

窗口 ID 来自 `list`。指针坐标以目标窗口左上角为原点，单位为原始像素。Windows 拒绝切换前台时，手动激活目标窗口后再试。截图需要目标程序支持窗口绘制，且当前模型支持图像输入。

鼠标活动时间保存在本机监视程序的内存中。调用 `capture` 时，选定窗口的截图会保存为 DSH 会话附件，并提供给当前模型。空闲设置作用于本插件发出的桌面操作。

在 Windows 上克隆仓库后，运行 `npm test` 可执行自动化测试。源码采用 [MIT 许可证](./LICENSE)。
