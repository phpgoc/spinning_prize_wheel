# 编译说明

项目只支持 Windows 原生环境，不使用 WSL。命令均在 PowerShell 中执行。

## 环境准备

安装以下工具：

1. [Bun](https://bun.sh/) 1.3 或更高版本。
2. [Rustup](https://rustup.rs/) 和 `stable-x86_64-pc-windows-msvc` 工具链。
3. Visual Studio Build Tools 中的“使用 C++ 的桌面开发”和 Windows SDK。

检查环境：

```powershell
bun --version
rustup show active-toolchain
rustc --version
```

当前桌面程序使用 Rust 官方的 MSVC ABI 编译，但 `.cargo/config.toml` 已启用静态 C 运行库。Visual Studio Build Tools 只在编译机器上需要，最终用户不需要单独安装 VC++ Redistributable。SQLite 使用 `rusqlite bundled`，源码会直接编入程序，不会附带或依赖 `sqlite3.dll`。

普通版和猜蜜版各自包含一份 SQLite 引擎，但排名和别名仍使用同一个数据库文件。两个版本目前是独立安装包；保留静态引擎可避免共享 DLL 带来的安装顺序、升级版本和卸载引用问题。

Windows 10/11 通常已包含桌面界面所需的 WebView2；精简系统需要先安装 Microsoft Edge WebView2 Runtime。

## 安装依赖

```powershell
bun install --frozen-lockfile
```

## 本地运行

```powershell
# 网页版，包含四个 hash 地址
bun run dev

# 普通桌面版
bun run tauri:dev

# 猜蜜桌面版
bun run tauri:dev:caimi
```

## 检查

```powershell
bun run check
bun test
cargo test --manifest-path src-tauri/Cargo.toml
```

## 构建网页版

```powershell
bun run build:web
```

产物位于 `dist`。普通 Web 构建已经包含普通抽奖、普通排阵、猜蜜抽奖和猜蜜排阵四个地址。

生成 Release 使用的压缩包：

```powershell
Compress-Archive -Path dist\* -DestinationPath dist.zip -Force
```

## 构建 Windows 桌面版

同时构建普通版和猜蜜版：

```powershell
bun run build:windows
```

也可以分别构建：

```powershell
bun run tauri:build
bun run tauri:build:caimi
```

主要产物：

- `src-tauri\target\release\转盘工具.exe`
- `src-tauri\target\release\转盘工具-猜蜜版.exe`
- `src-tauri\target\release\bundle\nsis\转盘工具_版本号_x64-setup.exe`
- `src-tauri\target\release\bundle\nsis\转盘工具·猜蜜版_版本号_x64-setup.exe`

NSIS 安装包包含自定义卸载步骤，卸载时由用户决定是否删除本地数据库和配置，因此当前不生成 MSI 安装包。

## 中文文件名与编码

源代码、配置和文档统一使用 UTF-8。Rust、Tauri 和 NSIS 的 Windows 接口使用 Unicode，中文 EXE 与安装包名称不会依赖系统 GBK 代码页。

构建时使用 PowerShell 和 Bun，不要用旧版批处理脚本拼接中文路径；这样无论系统“非 Unicode 程序的语言”如何设置，都不会影响中文产物名称。
