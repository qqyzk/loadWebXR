# 修订实验实施记录

TMC 大修（M6–M9）所需实验的代码、流程和进度。审稿意见与整体计划见 `revision1/审稿意见与修改计划.md`，这里只记录实验怎么做。

分批顺序、每批的预期结果和检查点见 `revision1/实验/实验规划.md`（论文只需要 Fast 4G 和不限速两种条件，不测 Local Wifi）；下面“真机运行步骤”只是命令示例。

## 思路

每个实验配置对应一个固定网址，不再切分支、不再手动改 HTML 或重新构建：

1. `build_bundles.sh`：每种加载器打一个包 `bundles/my-aframe-<variant>.js`。
   - prism / no-chunk / priority-only / progressive：用 `aframe-master/switch-version.sh` 切换后构建。
   - baseline：直接取 `baseline` 分支里提交的编译包（即当时测 Baseline 用的文件），不切分支。
2. `runner/probe.mjs`：离线探针，在桌面 Chrome 上按手机视口打开 baseline 页面，第一帧时记录相机和每个模型实体的包围盒，计算 VIA 得分，写到 `probe/<app>.json`。
3. `gen_pages.py`：为每个应用 × 配置生成页面 `index.exp-<config>.html`（tale 另生成 `html/Beach.exp-<config>.html`），写入加载器包、分块、帧预算、请求顺序、优先级层数和测量选项；原 HTML 不动。网址清单写到 `pages.json`。
4. `exp-measure.js`：统一测量脚本，结果写入 `window.__exp`，完成后 `__exp.done = true`。`exp-stages.js`：分阶段耗时测量（R2-1）。
5. `runner/run.mjs`：自动化运行，按轮次随机顺序跑一组页面，结果存为 `results/<session>/<app>/<config>/run_NN.json`。
6. `analyze.py`：汇总一个 session，输出 `runs.csv`、`summary.csv`、`visibility.csv`、`stages.csv`。

## 真机运行步骤

```bash
# 0. 一次性准备（已完成）：brew install --cask android-platform-tools；cd experiment/runner && npm install
# 1. 手机：开发者选项里打开 USB 调试，连上 Mac 并授权；打开 Chrome；横屏固定在支架上；关掉省电模式和自动亮度
cd experiment/runner
node preflight.mjs                      # 检查设备、Chrome 版本、视口、帧率、端口转发和限速，
                                        # 并按手机实际视口自动重跑探针、重新生成页面（整个 session 保持同一方向）
# 2. 试跑：hallo 两个配置各 3 次，和旧数据比量级
node run.mjs --session pixel6-trial --set main --configs baseline,prism-4g_30 --apps hallo --runs 3
python3 ../analyze.py pixel6-trial
# 3. 正式：主实验（11 个配置 × 3 个应用 × 10 轮，约 5–6 小时）
node run.mjs --session pixel6-main-fast4g --set main --network fast4g --runs 10
python3 ../analyze.py pixel6-main-fast4g
# 4. 主实验选出每个应用最好的分块配置后，更新 gen_pages.py 的 BEST_PROFILE，重新生成，再跑：
node run.mjs --session pixel6-levels-fast4g --set levels --network fast4g --runs 10
node run.mjs --session pixel6-stress-fast4g --set stress --network fast4g --runs 10
node run.mjs --session pixel6-stages --set stages --network none --runs 5
```

常用选项：`--apps tale,hallo,mus`、`--configs a,b`、`--cooldown 20`（秒）、`--max-temp 38`（电池温度 °C，超过就等待）、`--dry-run`（只打印运行顺序）、`--target desktop`（桌面 Chrome 冒烟测试）。中断后用同一命令重跑即可续跑，已有结果文件会跳过；失败记录在 `failures.jsonl`（含失败时页面已测到的数据和报错）。

## 配置

### main（M6/M7：R3-3、R2-5、R3-1、R1-5、R1-3）

| 配置名 | 加载器包 | 分块 | 说明 |
|---|---|---|---|
| baseline | baseline | — | Baseline：全部加载完再渲染 |
| progressive | progressive | — | 常规渐进加载：立即渲染，所有资源按文档顺序一次发出、到了就处理 |
| via | progressive | — | VIA：同上，但按 VIA 得分顺序发请求 |
| unthrottled | priority-only | — | 论文的 Unthrottled：有优先级，无分块、无帧预算 |
| no-chunk | no-chunk | — | 优先级 + 帧预算，无分块（分块表 #100） |
| nobudget-4g_20/30/50 | prism | 4g_20/30/50 | 优先级 + 分块，无帧预算（`frame-budget="off"`，补齐消融） |
| prism-4g_20/30/50 | prism | 4g_20/30/50 | 完整 PrismLoader（分块表 #120/#130/#150） |

PrismLoader 的结果取每个应用三个分块配置中 MaxFT 均值最低的一个（与原论文一致，`analyze.py` 会打印）。#100/#120/#130/#150 与 no-chunk、4g_20/30/50 的对应已用旧数据核对：重新计算的 MaxFT 与论文表格完全一致。

### levels（M8：R1-1、R1-2）

PrismLoader + 每个应用最好的分块配置（`BEST_PROFILE`，先按论文填 tale 4g_50、hallo 4g_30、mus 4g_20），优先级层数 2/3/4 × 视角 static / turn-away（第一帧起 1 s 内转身 180°）/ look-around（12 s 环视 360°），共 9 个配置。页面每帧记录各模型实体是否在视锥内、是否已加载，得到首次进入视野时间、进入视野时是否已加载、“在视野内但未加载”的时长。

- 2 级：P1 | 其余全部。3 级：原分配。4 级：原分配中模型最多的非 P1 层按 VIA 角度（离初始视线近的在前）对半拆开，后面的层顺延。
- mus 原分配只有 P1、P2 两层，所以它的“3 级”实际是 2 层，“4 级”是 3 层。

### stress（M9：R2-2）

prism / nobudget / unthrottled × 每帧人为渲染负载 const10（10 ms）、const20（20 ms，超过 16.7 ms 预算）、wave（0–16 ms，周期 2 s），最长 120 s。

### stages（M9：R2-1）

每个应用一个页面，逐个模型测：解析（GLTFLoader.parseAsync，文件已在内存，不含网络）、加入场景（setObject3D）、着色器编译、纹理上传、首次绘制（含几何缓冲上传，gl.finish 等待 GPU 完成）。同步阶段的主线程阻塞时间等于其耗时；解析是异步的，阻塞时间按 Long Tasks 统计。下载耗时用 main 组记录的 Resource Timing。三个应用的模型都没有 Draco/meshopt 压缩，“解压”只有纹理图片解码（包含在解析里，Chrome 在后台线程解码）。

## 测量定义

- **TTFF**：从点击开始按钮到“所有可见 P1 `<a-gltf-model>` 触发 model-loaded 之后渲染的第一帧”。沿用原 baseline 脚本的定义；对先加载 P1 再开始渲染的加载器，结果等于第一帧。常规渐进加载一开始就渲染，必须用这个定义。
- **平滑度**：a-scene 记录的每帧间隔（`scene.remTimes`，论文 FTSD/MaxFT 用的就是它），取 TTFF 之后、`allAssetsLoaded == false` 的帧，去掉前 3 帧（与原 `analyze_fluency.py` 一致）。指标：FTSD、MaxFT、Top3-FT、P99、1% low（最慢 1% 帧的平均帧率）、掉帧比例（按本次运行帧间隔中位数作为显示周期）。
- **统计**：每个应用 × 配置 10 次，报告均值、标准差、中位数、95% 置信区间（t 分布）。
- **固定视角**：所有页面在相机就绪时关闭陀螺仪控制（look-controls 的 magicWindowTrackingEnabled），每次都从应用设计的初始视角开始，与手机摆放无关。
- 另记录：每个模型的 model-loaded 时间、全部资源加载完成时间、每个请求的 Resource Timing、浏览器 UA、视口、电池温度。

## 网络

限速用 CDP `Network.emulateNetworkConditions`，即 DevTools 限速菜单使用的同一命令。数值取自 devtools-frontend `NetworkManager.ts`：Fast 4G 为延迟 165 ms（60×2.75）、下行 1012500 B/s（9 Mbps×0.9）、上行 168750 B/s（1.5 Mbps×0.9）。每次运行前清空并禁用缓存。

页面由 runner 内置的静态服务器提供（根目录 `code/realCase`，端口 8080，HTTP/1.1），手机通过 `adb reverse` 走 USB 访问 `localhost:8080`。

## 代码修改记录

- **mus 页面**：`Virtual-Reality-Museum-master/index.html` 中 4 个实体（`castle_lake`、`female_head` 两个模型，两段博物馆音频）引用的资源已被注释掉，main 各加载器的组件在初始化时会抛异常；若异常发生在渲染循环内，渲染会停止（桌面冒烟测试中 unthrottled 6 次有 5 次卡住）。已将这 4 个实体注释掉。它们本来就加载不到任何内容，抛异常时也没有登记加载任务，不改变加载行为。
- **prism 加载器**（`a-assets-prism.js`）：队列支持到 4 级，结束条件改为实际出现的最高级（至少 3，3 级页面行为不变）；新增 `frame-budget="off"`，只启动一个不受时间限制的处理循环，用于“优先级 + 分块、无预算”消融。默认行为不变。
- **新加载器** `a-assets-progressive.js`：由 priority-only 派生，只改调度入口（见配置表）；`load-order="via"` 时按 `via-rank` 排序发请求。
- **VIA 打分**（mavens-lab/webxr_latency `VIA.py`）：得分 = 包围盒中心与视线方向的夹角（弧度）+ 2 ×（包围盒不在视锥内 ? 1 : 0），从小到大发请求；距离函数在原代码里没有参与最终得分。VIA 对 glTF primitive 打分，我们的应用本来就是独立模型文件，所以按模型实体打分，一个资源取用到它的实体中的最小值。

## 发现与待确认

- **原 P1 无法完全复现**：`classify/*-priority.json` 的生成代码不在仓库里。用探针在竖屏 412×915、横屏 915×412、桌面 1280×720 三种视口下检查初始视锥：tale 完全一致；hallo 竖屏缺 zombi/werewolf/bat，横屏多出 skeleton/pumpkin_happy（P2）；mus 的 floor、lamps 在任何视口下都不在初始视锥内（lamps 位于相机正后方），fractal 系列实体已被注释。主实验的 TTFF 只依赖 `priority` 属性，不受影响；VIA 顺序和 R1-1 的可见性统计用探针结果，视口需与真机一致（默认横屏，真机 preflight 后按实际视口重跑探针）。
- **渲染持续超预算时 PrismLoader 会饿死**：桌面冒烟测试中 prism-const20 三个应用都在 120 s 内没加载完，tale 的 prism-const10 也超时；nobudget 和 unthrottled 都能加载完。原因是剩余预算一直为负时 `doTasks` 一个任务也不执行。R2-2 的回复需要处理这一点（例如每帧至少执行一个任务），改不改由论文方案决定。
- **常规渐进加载 / VIA 的 TTFF 接近 Baseline**（桌面 Fast 4G 单次）：所有请求同时发出、共享带宽，P1 要和其他资源一起下完；VIA 的顺序只影响超出 6 个并发连接后的排队。mus 在这两种配置下 P1 最后才完成，TTFF 之后没有加载阶段，平滑度为空。
- **帧预算写死为 16.7 ms**：Pixel 6 屏幕是 90 Hz，preflight 会测出浏览器实际 rAF 帧率。

## 待办

- [x] 构建脚本、页面生成器、统一测量脚本、自动化 runner、分析脚本
- [x] 新加载器 progressive / VIA，prism 的 4 级与无预算开关
- [x] 探针（VIA 得分、实体包围盒）、可见性统计、转头脚本、渲染负载、分阶段测量
- [x] 桌面 Chrome 冒烟测试：四组全部页面不限速各跑一次，main 组全部配置 Fast 4G 各跑一次
- [x] 安装 adb，写 preflight（自动按手机视口重跑探针、重新生成页面）
- [ ] 提交：code 仓库的 husky pre-commit lint 在旧机器上一直被跳过（钩子里写的是旧机器的 nvm 路径），现在会因 aframe-master 里原有的 lint 问题失败；是否用 `--no-verify` 提交由作者决定

真机测试（需要连接 Pixel 6）：

- [ ] preflight（含按实际视口重跑探针）
- [ ] 试跑（hallo，baseline 与 prism-4g_30 各 3 次），与旧数据对比量级
- [ ] 正式运行：main → 更新 BEST_PROFILE → levels、stress、stages

## 进度

| 日期 | 内容 |
|---|---|
| 2026-11-17 | main 快进到 `before_revision_main` 快照；完成实验框架（构建、生成、测量、runner）；修复 mus 页面悬空实体；桌面冒烟测试通过 |
| 2026-11-17 | 新增 progressive/VIA 加载器、prism 4 级与无预算开关、探针、levels/stress/stages 三组页面、分析脚本、preflight；安装 adb；四组桌面冒烟测试通过 |
