# 你有多容易被人欺负测试

你是软柿子体质吗 · 娱乐向自我观察

线上地址：<https://zengpenghui420-glitch.github.io/soft-persimmon/>

用手机浏览器打开。首页输入订单号后开始：到小红书「我的订单」复制订单号，每个订单号可以测 3 次。18 道原创中文日常情景题，五级自评（完全不像我 → 非常像我），三个维度各 6 题：拒绝困难、边界松软、冲突回避。其中每维有 1 道反向题，计分时已反过来，页面上不单独标注。结果给出软柿子指数（0–100）、体质等级、主导画像、三维雷达、特征表现和护界小建议。

本测试为娱乐向自我观察，题目为原创日常情景，非正式心理测量、非诊断。软柿子指数只是「在关系里更容易退让」的倾向线索。高分不等于软弱无能，也不是性格缺陷。

订单号只做格式、绑定和次数控制，不能证明已经付款。请求里的 quiz 键是 `soft`，不是仓库名。

## 订单号

订单号走 MantleDB，和已发出的访问码同一个 namespace，但是单独的集合。页面不再为订单号请求 `*.vercel.app`。

| 项 | 值 |
|---|---|
| 存储 | MantleDB `catquiz-zph420-codes` / `orders/{订单号}` |
| 只读 | `GET /v2/.../orders/{订单号}`，不扣次、不绑定 |
| 第一次 | 文档不存在时才 `POST` 新建：`quiz=soft`，`uses=1`，`remaining=2`，`max=3` |
| 之后 | 只对已有文档 `increment` `uses`（+1）。不再 `POST` 整份文档 |
| 次数 | 一个订单号只绑定这一个测试，最多 3 次 |
| 扣次 | 第一次开始答题扣 1 次；中途刷新、继续这一次、刷新结果不扣；再测一次才再扣 |
| 用完 | 第 4 次拒绝，原来的结果还在 |
| 别的测试 | 文档里的 `quiz` 不是 `soft` 时拒绝，并且不写 |

`POST /v2/{namespace}/{path}` 会整份覆盖，而且不认 `If-Match` / `If-None-Match`。缺文档时 `increment` 不会建档（返回 404），`PATCH` 也不会。所以页面只在读到 404 之后 POST 一次初始记录；只要读到了记录，后面只做原子 `uses +1`，避免把次数打回初始值或改掉绑定。访问码仍在 `sp/`，订单号不会读写那个集合。

## 已发出的访问码

页面不提示旧码。已经发出的码仍走原来的双读，语义不变：先 `POST /redeem`，vault 明确用尽则不再落到 Mantle；vault 没有这枚码时才回退 Mantle `sp/`。`GET /get` 只读。其他测验的码不能用在这里。卖家说明见 [CODES.md](CODES.md)。

| 项 | 值 |
|---|---|
| 前缀 | `SP` + 4 位 |
| 字符表 | `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（不含 I、L、O、0、1） |
| 集合 | MantleDB `catquiz-zph420-codes` / `sp/` |
| 次数 | 每个码 3 次 |
| 再测一次 | 清掉本次解锁，再次核销，扣 1 次 |
| 查看上次结果 | 只读本地记录，不扣次 |
| 已解锁后再点开始 | 同一标签页里不重复扣次 |

造码（在已配置 `MANTLE_KEY` 或 `MANTLE_CREDS` 的机器上）：

```bash
MANTLE_KEY=*** ./tools/mint.sh 5
# 或
MANTLE_CREDS=/path/to/mantle.json ./tools/mint.sh 5
```

不带参数时默认一次造 10 个。每个码写入 `sp/{验证码}`，`remaining` 与 `max` 都是 3。

## 本地预览

```bash
python3 -m http.server 8080
```

打开 <http://127.0.0.1:8080/> 。页面是单文件 `index.html`。

## GitHub Pages

仓库需保持 **Public**。Pages 从 `main` 分支的根目录 `/` 发布。

若尚未开启：仓库 **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`，Folder: `/ (root)` → Save**。根目录有 `.nojekyll`，避免 Jekyll 改写页面。
