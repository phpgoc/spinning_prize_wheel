# 编译说明

下面从一台没有开发环境的 Windows 10/11 电脑开始说明。项目必须在 Windows 原生 PowerShell 中编译，不要在 WSL 中执行。

## 1. 安装编译工具

### 1.1 安装 Bun

打开 Windows PowerShell，执行 Bun 官方安装命令：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

安装完成后关闭 PowerShell，再重新打开一个 PowerShell 窗口，检查版本：

```powershell
bun --version
```

应当显示 `1.3` 或更高版本。如果仍提示“无法识别 bun”，先重启终端；仍无效时按 [Bun 官方安装说明](https://bun.sh/docs/installation) 检查环境变量。

### 1.2 安装 Rust

从 [Rustup 官网](https://rustup.rs/) 下载并运行 `rustup-init.exe`，安装时选择默认选项。安装完成后重新打开 PowerShell，执行：

```powershell
rustup default stable-x86_64-pc-windows-msvc
rustup update stable
rustc --version
cargo --version
```

`rustc` 和 `cargo` 都能显示版本号才表示安装成功。

### 1.3 安装 Visual Studio Build Tools

从 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 下载并运行安装器。在“工作负荷”中勾选：

- 使用 C++ 的桌面开发。

并确认右侧安装详细信息中包含：

- MSVC v143 C++ x64/x86 生成工具。
- Windows 10 SDK 或 Windows 11 SDK。

这部分只在编译电脑上需要，安装程序的最终用户不需要安装 Visual Studio。

### 1.4 WebView2

Windows 10/11 通常已经安装 WebView2。若桌面程序启动后只有空白窗口，从 [Microsoft WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) 安装 Evergreen Runtime。

## 2. 获取源代码

推荐先安装 [Git for Windows](https://git-scm.com/download/win)，然后执行：

```powershell
Set-Location D:\code
git clone https://github.com/phpgoc/spinning_prize_wheel.git
Set-Location .\spinning_prize_wheel
```

也可以在 GitHub 项目页面选择“Code → Download ZIP”，解压后进入该目录。在资源管理器地址栏输入 `powershell` 并回车，就会在当前目录打开终端。

执行下面的命令确认当前目录正确：

```powershell
Get-Location
Get-ChildItem package.json, version
```

能同时看到 `package.json` 和 `version` 文件后再继续。

## 3. 安装项目依赖

在项目根目录执行：

```powershell
bun install --frozen-lockfile
```

第一次安装需要联网。以后 `bun.lock` 没有变化时通常不必重复安装。

## 4. 本地运行

### 4.1 运行网页版

```powershell
bun run dev
```

也可以简写成 `bun dev`。终端显示 `Local: http://localhost:5173/` 后，用浏览器打开这个地址。开发版包含四个页面：

- `http://localhost:5173/#/draw`
- `http://localhost:5173/#/lineup`
- `http://localhost:5173/#/caimi/draw`
- `http://localhost:5173/#/caimi/lineup`

终端必须保持打开；需要停止时在该终端按 `Ctrl + C`。

### 4.2 运行普通桌面版

先停止正在运行的 `bun dev`，因为 Tauri 会自动启动自己的网页开发服务。然后执行：

```powershell
bun run tauri:dev
```

也可以简写成 `bun tauri:dev`。第一次会编译 Rust 依赖，等待数分钟属于正常现象，编译完成后会自动打开“转盘”。

### 4.3 运行猜蜜桌面版

```powershell
bun run tauri:dev:caimi
```

同一时间只运行一个开发命令，避免多个进程争用 `5173` 端口。

## 5. 设置产物版本号

项目根目录的 `version` 文件是构建产物版本号的唯一来源。文件中只写一行，例如：

```text
0.1.0
```

支持 `1.2.3` 或 `1.2.3-beta.1` 这类版本号。修改并保存后，后续网页目录和 Windows 安装包都会使用这个版本号。

## 6. 构建网页 dist

执行：

```powershell
bun run build
```

也可以使用同义命令：

```powershell
bun run build:web
```

假设 `version` 是 `0.1.0`，产物目录为：

```text
dist\转盘-0.1.0
```

该目录已经包含普通抽奖、普通分组、猜蜜抽奖和猜蜜分组四个地址。部署时上传目录内的全部文件，并把 `index.html` 作为入口。

需要制作网页压缩包时执行：

```powershell
$version = (Get-Content .\version -Raw).Trim()
Compress-Archive -Path ".\dist\转盘-$version\*" -DestinationPath ".\转盘-$version-web.zip" -Force
```

## 7. 构建 Windows 安装包

关闭仍在运行的开发版程序，然后执行：

```powershell
bun run build:windows
```

这个命令会依次完成以下工作：

1. 构建猜蜜版网页和 `转盘-猜蜜版.exe`。
2. 构建普通版网页和 `转盘.exe`。
3. 把两个 EXE 打进同一个 NSIS 安装包。

第一次完整构建耗时较长。假设 `version` 是 `0.1.0`，主要产物为：

```text
src-tauri\target\release\转盘.exe
src-tauri\target\release\转盘-猜蜜版.exe
src-tauri\target\release\bundle\nsis\转盘-0.1.0-setup.exe
```

正式分发最后一个 `setup.exe` 即可。它会把普通版和猜蜜版两个可执行文件安装到同一目录，并创建两个启动入口。项目不生成 MSI。

## 8. 构建前检查

建议在正式构建前依次执行：

```powershell
bun run check
bun run test
bun run test:e2e:web
bun run test:e2e:tauri
cargo test --manifest-path src-tauri/Cargo.toml
```

`test:e2e:web` 会启动本地网页并测试四个正式地址；`test:e2e:tauri` 会构建普通版和猜蜜版 Debug EXE，再启动真实 WebView2 窗口进行桌面冒烟测试。也可以用 `bun run test:e2e` 依次执行两组 E2E。

任意一条命令失败时，应先处理错误再发布产物。

## 9. 最终用户依赖

桌面程序使用 Rust 官方 MSVC ABI 编译，但 `.cargo/config.toml` 会把 C 运行库静态链接进 EXE。因此 Visual Studio Build Tools 只在编译电脑上需要，最终用户不需要另装 VC++ Redistributable。

SQLite 使用 `rusqlite bundled`，SQLite 源码会分别编译进普通版和猜蜜版，不依赖 `sqlite3.dll`。两个程序仍然共用同一个排名和别名数据库文件，抽奖与分组历史按版本分开保存。

## 10. 常见问题

### `bun`、`cargo` 或 `rustc` 无法识别

关闭当前 PowerShell，重新打开后再试。若仍无效，重新运行对应安装器并检查环境变量。

### 提示找不到 `link.exe`、`cl.exe` 或 Windows SDK

重新打开 Visual Studio Installer，修改 Build Tools 安装，确认“使用 C++ 的桌面开发”、MSVC v143 和 Windows SDK 都已勾选。

### 提示 `5173` 端口被占用

通常是上一次 `bun dev` 或 `bun tauri:dev` 没有停止。回到旧终端按 `Ctrl + C`，或在任务管理器中结束残留的 Bun、Node、转盘开发进程，然后重试。

### 构建时提示文件被占用或拒绝访问

关闭正在运行的 `转盘.exe`、`转盘-猜蜜版.exe` 和旧安装包，再重新执行构建命令。

### 中文文件名会不会受 GBK 影响

不会。源码和文档使用 UTF-8，Rust、Tauri 和 NSIS 调用 Windows Unicode 接口，中文 EXE 与安装包名称不依赖系统 GBK 代码页。应使用 PowerShell 和 Bun 执行本文命令，不要改用旧式批处理脚本拼接中文路径。
