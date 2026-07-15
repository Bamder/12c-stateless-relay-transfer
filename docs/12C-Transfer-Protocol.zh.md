```
Internet-Draft（Informational）
12C 无状态中继传输协议
密码学与 Wire 格式规范
版本 2
2026 年 7 月
```

# 12C 无状态中继传输协议

## 密码学与 Wire 格式规范

|          |                         |
| -------- | ----------------------- |
| 文档编号 | 12C-Transfer-Protocol   |
| 版本     | 2                       |
| 日期     | 2026 年 7 月            |
| 类别     | Informational（信息性） |
| 范围     | 线速密码学与对象布局    |

---

## 摘要

本文档定义 **12C Stateless Relay Transfer** 对象格式：定长元数据块（SMB）、AES-256-GCM 载荷保护、基于 Wire 块的 Merkle 完整性校验，以及用于不透明块存储的确定性 Token 标识符。

规定两种载荷加密方式，分别对应两个协议版本：

- **V2** — 对完整填充明文执行单次 GCM。
- **V2.1** — 对明文分段执行多次独立 GCM；SMB 线速尺寸与 `version` 字节不变。

传输、存储路由与 HTTP API 不在范围内。对等方通过 Token 标识符交换不透明字节块。

---

## 文档状态

本文档为 12C 线速格式的**信息性（Informational）**规范，非 Internet Standards Track 文档。

声称兼容 **V2** 的实现**必须**支持 `segment_code = 0`。声称兼容 **V2.1** 的实现**必须**额外支持 [第 6.4 节](#64-文件名槽位与-segment_code) 中的 `segment_code` 取值。

---

## 目录

1. [引言](#1-引言)
2. [术语](#2-术语)
3. [协议模型](#3-协议模型)
4. [凭证](#4-凭证)
5. [密码学算法](#5-密码学算法)
6. [SMB — 超级元数据块](#6-smb--超级元数据块)
7. [载荷加密](#7-载荷加密)
8. [Wire 编码](#8-wire-编码)
9. [Merkle 完整性树](#9-merkle-完整性树)
10. [发送方行为](#10-发送方行为)
11. [接收方行为](#11-接收方行为)
12. [协议版本](#12-协议版本)
13. [安全考量](#13-安全考量)
14. [IANA 考量](#14-iana-考量)
15. [规范性引用](#15-规范性引用)

- [附录 A. 协议常量](#附录-a-协议常量)
- [附录 B. Wire 布局算法](#附录-b-wire-布局算法)
- [附录 C. 资料性指南](#附录-c-资料性指南)

---

## 1. 引言

### 1.1. 目的

12C 将文件编码为一组具名字节块（Token）与一个 12 字符凭证。持有凭证与全部 Token 的对等方可校验完整性并还原文件。本格式不要求服务端为每个对象维护会话状态。

### 1.2. 规范性用语

关键词 **必须（MUST）**、**禁止（MUST NOT）**、**应当（SHOULD）**、**不应（SHOULD NOT）**、**可以（MAY）** 应按照 [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119) 解释。

### 1.3. 约定

- **字节（octet）：** 8 位。
- **字节串：** 有序字节序列。
- 多字节整数均为**无符号**，除非另有说明。
- 区间采用半开表示 `[start, end)`。
- `||` 表示字节串拼接。
- `ceil(x)` 为不小于 x 的最小整数。

### 1.4. 范围与非目标

**范围内：** 凭证布局、SMB、载荷加密（V2/V2.1）、Wire 分块、Merkle 根、Token 派生。

**范围外：** 块上传/下载协议、副本、TTL 策略、TLS 用法、凭证生成熵的详细要求（见 [第 13 节](#13-安全考量) 概述）。

---

## 2. 术语

| 术语               | 定义                                              |
| ------------------ | ------------------------------------------------- |
| 凭证（Credential） | 12 字符码：6 字符搜索码 + 6 字符密钥码            |
| SMB                | Super Metadata Block；345 字节定长元数据          |
| S_enc              | 经 K_smb 加密的 SMB 明文；373 字节                |
| Token              | 64 字符小写十六进制标识符，标记一个 Wire 块       |
| Wire 块            | 存于某一 Token 下的字节串                         |
| 加密段（Segment）  | （V2.1）单次 GCM 所覆盖的明文范围                 |
| FEK                | 32 字节随机文件加密密钥                           |
| KEK                | 由密钥码与 salt_rand 派生的 32 字节密钥；封装 FEK |
| 逻辑块             | 载荷密文切分后的片段 B_i                          |
| segment_code       | 选择 V2 / V2.1 分段大小的 16 位字段               |

---

## 3. 协议模型

### 3.1. 对象组成

```text
凭证（12 字符，带外分发）
        +
Token[0] || Token[1] || ... || Token[m-1]
        |
        v
   还原文件字节
```

### 3.2. 数据流

```text
文件明文
    -->（可选前缀零填充）
    --> 载荷加密（V2 或 V2.1）--> C
    --> Wire 切分 --> B_1 .. B_m
    --> Merkle 根 --> SMB body
    --> SMB 序列化（345）--> 加密 --> S_enc（373）
    --> Token[0] = S_enc || B_m；Token[i] = B_i（i >= 1）
```

### 3.3. 不变量

1. SMB 明文长度**必须**为 345 字节。
2. S_enc 长度**必须**为 373 字节。
3. 本文档所有版本的 SMB `version` **必须**为 2。
4. 加密段边界（V2.1）与 Wire Token 边界相互独立。

---

## 4. 凭证

### 4.1. 语法

```abnf
credential     = search-code key-code
search-code    = 6OCTET
key-code       = 6OCTET
```

12 字符对本规范为不透明串。解析：

```text
search_code = credential[0:6]
key_code    = credential[6:12]
```

接收方**必须**拒绝长度不为 12 的凭证。

---

## 5. 密码学算法

### 5.1. 对称加密

| 参数       | 值                                   |
| ---------- | ------------------------------------ |
| 算法       | AES-256-GCM                          |
| 密钥宽度   | 256 位（32 字节）                    |
| Nonce 宽度 | 96 位（12 字节），每次加密新鲜随机   |
| Tag 宽度   | 128 位（16 字节）                    |
| 信封开销   | 28 字节（nonce + tag；不含密文本体） |

### 5.2. GCM 记录格式

单次加密输出（**GCM 记录**）**必须**编码为：

```text
+--------+--------+-------------+
| nonce  | tag    | ciphertext  |
| 12     | 16     | N           |
+--------+--------+-------------+
```

记录长度 = N + 28。解密**必须**校验 tag；失败**必须**中止。

### 5.3. 密钥层次

**慢 KDF：**

```text
SlowKDF(password, salt, iter, len) = PBKDF2-HMAC-SHA256(
    password, salt, iter, len)
```

| 密钥  | 派生                                     |
| ----- | ---------------------------------------- |
| K_smb | SlowKDF(key_code, SALT_SMB, 100000, 32)  |
| K_kek | SlowKDF(key_code, salt_rand, 100000, 32) |
| K_fek | 32 字节均匀随机                          |

K_smb 的规范盐值：

```text
SALT_SMB = "12C-v2-KEY-SALT"  （ASCII，14 字节）
```

`salt_rand` 为存入 SMB 的 16 字节（见 [第 6.2 节](#62-body-字段)）。

### 5.4. Token 标识符

```text
SALT_TOKEN = "12C-v2-SEARCH-SALT"  （ASCII，19 字节）

token_digest = HKDF-SHA256(
    IKM  = octets(search_code),
    salt = SALT_TOKEN,
    info = "Index-" || decimal_string(index) || "-12C",
    L    = 32)

Token(index) = lowercase_hex(token_digest)   ; 64 个十六进制字符
```

`index` 为从 0 开始的非负整数。

### 5.5. 哈希

SMB 摘要与 Merkle 节点均使用 SHA-256。

---

## 6. SMB — 超级元数据块

SMB 为**固定顺序 Schema**（类协议头），非自描述映射。按序消费字段；结构之后的多余尾部字节**必须**导致拒绝。

### 6.1. SMB 明文（345 字节）

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          magic（32 位）                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|ver|                    body（272 字节）                        |
|   |                                                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   body_hash（长度 + 32 字节）                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   payload_hash（32 字节）                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| 偏移 | 长度 | 字段         | 语义                              |
| ---- | ---- | ------------ | --------------------------------- |
| 0    | 4    | magic        | **必须**为 `0x31433232`   |
| 4    | 1    | version      | **必须**为 `2`            |
| 5    | 272  | body         | [第 6.2 节](#62-body-字段)         |
| 277  | 36   | body_hash    | `u32_be(32)` \|\| SHA-256(body) |
| 313  | 32   | payload_hash | SHA-256(字节[0:313])              |

**校验：**

1. 重算并匹配 `payload_hash`。
2. 重算并匹配 `body_hash`。
3. 总长度**必须**恰好为 345 字节。

Body 内**带长度前缀**字段格式为 `u32_be(L)` \|\| L 字节。

### 6.2. Body 字段

| 序号 | 字段                 | 编码                                                  |
| ---- | -------------------- | ----------------------------------------------------- |
| 1    | root_hash            | `u32_be(32)` \|\| 32 字节                           |
| 2    | encrypted_fek        | `u32_be(60)` \|\| 封装 FEK 的 GCM 记录              |
| 3    | salt_rand            | `u32_be(16)` \|\| 16 字节                           |
| 4    | num_tokens           | u32_be                                                |
| 5    | wire_block_size      | u32_be                                                |
| 6    | ciphertext_length    | u64_be                                                |
| 7    | original_file_length | u64_be                                                |
| 8    | file_name_slot       | 128 字节；见[第 6.4 节](#64-文件名槽位与-segment_code) |

### 6.3. 加密 SMB 放置

```text
S_enc = GCM-Encrypt(K_smb, SMB_plaintext)
|S_enc| 必须等于 373
```

S_enc **必须**占据 Token[0] 最前 373 字节，无长度前缀。

### 6.4. 文件名槽位与 segment_code

Body 末字段为定长 **128 字节**槽位。

#### 6.4.1. 版本 V2（segment_code = 0）

- 字节 `[0, 128)` 为 UTF-8 逻辑文件名，零填充。
- 解析器**必须**在首个 `0x00` 截断，或剥离尾部 `0x00`。
- 写入时的路径规范化与 UTF-8 截断为本地策略。

当 `[120, 128)` 全为零时，`segment_code` 为 **0**（V2 整包模式）。

#### 6.4.2. 版本 V2.1（segment_code ≥ 1）

```text
[0, 120)   file_name      UTF-8，零填充
[120, 122) segment_code   uint16_le
[122, 128) reserved       必须为 0
```

**segment_code 注册表：**

| 编码 | 版本 | 分段明文大小       |
| ---- | ---- | ------------------ |
| 0    | V2   | （完整填充明文）   |
| 1    | V2.1 | 2^4 MiB = 16 MiB   |
| 2    | V2.1 | 2^5 MiB = 32 MiB   |
| 3    | V2.1 | 2^6 MiB = 64 MiB   |
| 4    | V2.1 | 2^7 MiB = 128 MiB  |
| 5    | V2.1 | 2^8 MiB = 256 MiB  |
| 其它 | —   | **必须**拒绝 |

当编码 ≥ 1：

```text
i = code - 1
segment_plaintext_bytes = 2^(i + 4) * 2^20
```

当 code > 0 时，若 `[122, 128)` 任一保留字节非零，解析器**必须**拒绝。逻辑文件名**禁止**超过 120 UTF-8 字节。

---

## 7. 载荷加密

### 7.1. 明文填充

发送方**可以**在文件明文**前缀**追加 `plaintext_padding` 个零字节，以满足 Wire 整除（[附录 B](#附录-b-wire-布局算法)）。

- `|plaintext_padded| = original_file_length + plaintext_padding`
- 填充**必须**为前缀。
- 接收方解密后**必须**去除前 `plaintext_padding` 字节。

### 7.2. 版本 V2 — 整包模式

当 `segment_code = 0`：

```text
C = GCM-Encrypt(K_fek, plaintext_padded)     ; 单条记录

ciphertext_length 必须等于 |plaintext_padded| + 28
```

### 7.3. 版本 V2.1 — 分段模式

当 `segment_code >= 1`：

1. 将 `plaintext_padded` 切为不超过 `segment_plaintext_bytes` 的段；末段可更短。
2. 每段在 K_fek 下形成独立 GCM 记录。
3. 顺序拼接：`C = record_1 || record_2 || ... || record_n`。

```text
n = ceil(|plaintext_padded| / segment_plaintext_bytes)

ciphertext_length 必须等于 |plaintext_padded| + n * 28
```

每段 nonce **必须**独立。接收方**禁止**从 Wire 块边界推断 GCM 段边界。

### 7.4. FEK 封装

```text
encrypted_fek = GCM-Encrypt(K_kek, K_fek)
```

写入 SMB 字段 `encrypted_fek`。

---

## 8. Wire 编码

在已知 `ciphertext_length` 后，V2 与 V2.1 规则相同。

### 8.1. 总长度

```text
SMB_ENC_SIZE = 373

total_wire = SMB_ENC_SIZE + ciphertext_length
```

### 8.2. 符号

| 符号 | SMB 来源        | 含义                 |
| ---- | --------------- | -------------------- |
| m    | num_tokens      | Token 数             |
| B    | wire_block_size | Token[1..m-1] 块大小 |
| B_m  | 导出            | 末段逻辑密文长度     |

**约束：**

```text
m * B = total_wire
B_m + SMB_ENC_SIZE = B
ciphertext_length = (m - 1) * B + B_m
```

### 8.3. 逻辑块

将载荷密文 C 连续切分：

```text
|B_1| = ... = |B_{m-1}| = B
|B_m| = B_m
C = B_1 || B_2 || ... || B_m
```

### 8.4. Token 映射

```text
wire(Token[0])  = S_enc || B_m
wire(Token[i])  = B_i          ，i = 1 .. m-1

|wire(Token[i])| = B   （所有 i）
```

Token 名按 [第 5.4 节](#54-token-标识符) 派生。

### 8.5. 分段与 Wire

`segment_code` **禁止**影响 m 或 B。Token 布局仅取决于 `total_wire` 与 [附录 B](#附录-b-wire-布局算法) 算法。

---

## 9. Merkle 完整性树

### 9.1. 叶子

`L_i = SHA-256(B_i)`，i = 1 .. m。

### 9.2. 构造

子摘要从左到右拼接后 SHA-256。若某层节点数为奇数，**必须**复制末节点再配对。

### 9.3. 根

根摘要**必须**等于 SMB `root_hash`。接收方**必须**由 `{B_i}` 重算并校验；不一致**必须**拒绝。

---

## 10. 发送方行为

### 10.1. 输入

发送方**必须**获得：

- `file_plaintext` 与 `original_file_length`
- `credential`
- `segment_code`（显式给定；选择策略为本地事项，见 [附录 C](#附录-c-资料性指南)）
- 可选逻辑文件名

### 10.2. 公共步骤

1. 校验 `segment_code`。
2. 由 `original_file_length` 与 `segment_code` 计算 Wire 布局（[附录 B](#附录-b-wire-布局算法)）。
3. 构造 `plaintext_padded`。
4. 派生密钥；生成 FEK。
5. 按 [第 7 节](#7-载荷加密) 产生 C。
6. 切分为 `{B_i}`；计算 Merkle 根。
7. 序列化 SMB（345 字节），含 `segment_code`。
8. 构造 S_enc；组装 Token[0] 与 Token[1..m-1]。

### 10.3. 版本 V2

[第 10.2 节](#102-公共步骤) 且 `segment_code = 0`，对完整 `plaintext_padded` 单次 GCM。

### 10.4. 版本 V2.1

同 [第 10.2 节](#102-公共步骤)，但第 5 步为分段加密（[第 7.3 节](#73-版本-v21--分段模式)）。发送方**可以**按段大小流式处理明文；本格式**不要求**整文件驻留内存。

---

## 11. 接收方行为

### 11.1. 公共步骤

1. 取得 Token[0]；提取 S_enc（前 373 字节）。
2. 解密并解析 SMB；读取 `segment_code`、m、B、`ciphertext_length`。
3. 取得其余 Token；重组 `{B_i}`。
4. 校验 Merkle 根。
5. 派生 K_kek，解密 FEK。

### 11.2. 版本 V2

拼接逻辑块得 C。将 C 作为单条 GCM 记录解密。去除前缀填充；输出 `original_file_length` 字节。

### 11.3. 版本 V2.1

顺序遍历 C。每段读取一条 GCM 记录；明文长度由 `segment_plaintext_bytes` 与剩余输出长度确定。解密并拼接。去除前缀填充。

接收方**必须**仅依据 SMB 中的 `segment_code` 选择模式，**禁止**根据文件大小推测。

### 11.4. 失败条件

下列情况接收方**必须**失败：

- `|C| ≠ ciphertext_length`
- Merkle 校验失败
- 任一段 GCM 认证失败
- `segment_code` 无法识别
- `segment_code > 0` 时保留文件名字节非零
- Wire 尺寸约束不满足

---

## 12. 协议版本

| 版本 | segment_code | 载荷加密                           |
| ---- | ------------ | ---------------------------------- |
| V2   | 0            | [第 7.2 节](#72-版本-v2--整包模式)  |
| V2.1 | 1..5         | [第 7.3 节](#73-版本-v21--分段模式) |

**兼容性：**

| 场景                    | 要求                         |
| ----------------------- | ---------------------------- |
| V2.1 对等方读取 V2 对象 | **必须**成功           |
| V2 对等方读取 V2.1 对象 | **必须**失败（需升级） |
| V2.1 的 SMB`version`  | **必须**仍为 2         |
| SMB / S_enc 尺寸        | **必须**仍为 345 / 373 |

---

## 13. 安全考量

**凭证保密性。** `key_code` 泄露可解密内容；`search_code` 泄露有助于枚举 Token。凭证生成不在本文档范围内，但生产系统**必须**使用足够熵。

**GCM nonce 复用。** 同一密钥下复用 nonce 将破坏 GCM 安全。每次加密**必须**使用新 nonce。

**完整性。** **必须**在载荷解密前完成 Merkle 根校验。

**内存。** V2 在收发时对完整填充明文执行单次 GCM；大对象在受限环境中可能不实用。V2.1 允许按段缓冲。

**传输层。** 本文档不规定 TLS。运维方**应当**保护带外分发的凭证与块数据。

**Token 数量。** 对象较大且 Wire 块较小时会产生较多 Token，增加往返次数；属运维权衡，非密码学缺陷。

---

## 14. IANA 考量

本文档无 IANA 登记项。

`segment_code` 取值 0..5 定义于 [第 6.4.2 节](#642-版本-v21segment_code--1)。扩展须通过新版协议或更新本规范。

---

## 15. 规范性引用

**[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, 1997 年 3 月。

**[NIST-SP800-38D]** NIST, "Galois/Counter Mode (GCM) and GMAC", 2007。

**[RFC5869]** Krawczyk, H. and P. Eronen, "HKDF", RFC 5869, 2010 年 5 月。

**[RFC6234]** Eastlake 3rd, D. and T. Hansen, "US Secure Hash Algorithms", RFC 6234, 2011 年 5 月。

**[RFC8018]** Moriarty, K. et al., "PKCS #5 v2.1", RFC 8018, 2017 年 1 月。

---

## 附录 A. 协议常量

| 名称                    | 值                   |
| ----------------------- | -------------------- |
| CREDENTIAL_LENGTH       | 12                   |
| SEARCH_CODE_LENGTH      | 6                    |
| KEY_CODE_LENGTH         | 6                    |
| SMB_MAGIC               | 0x31433232           |
| SMB_VERSION             | 2                    |
| SMB_PLAIN_SIZE          | 345                  |
| SMB_ENC_SIZE            | 373                  |
| FILE_NAME_SLOT_SIZE     | 128                  |
| FILE_NAME_PAYLOAD_V21   | 120                  |
| SEGMENT_CODE_OFFSET     | 120                  |
| GCM_NONCE_SIZE          | 12                   |
| GCM_TAG_SIZE            | 16                   |
| GCM_ENVELOPE_SIZE       | 28                   |
| HASH_SIZE               | 32                   |
| SALT_RAND_SIZE          | 16                   |
| KEY_SIZE                | 32                   |
| PBKDF2_ITERATIONS       | 100000               |
| MAX_WIRE_BLOCK_SIZE     | 16 777 216（16 MiB） |
| WIRE_BLOCK_REF_SIZE     | 4 194 304（4 MiB）   |
| MIN_BLOCK_DIVISOR       | 8                    |
| MAX_TOKEN_SEARCH_WINDOW | 256                  |
| MAX_PLAINTEXT_PADDING   | 16 777 216（16 MiB） |
| TOKEN_HEX_LENGTH        | 64                   |
| SALT_SMB                | "12C-v2-KEY-SALT"    |
| SALT_TOKEN              | "12C-v2-SEARCH-SALT" |

---

## 附录 B. Wire 布局算法

**输入：** `original_file_length`，`segment_code`
**输出：** `(m, B, B_m, plaintext_padding)`

### B.1. 密文长度

令 P 从 `original_file_length` 起通过填充搜索递增。

```text
若 segment_code = 0：
    ciphertext_length(P) = P + GCM_ENVELOPE_SIZE
否则：
    n = ceil(P / segment_plaintext_bytes(segment_code))
    ciphertext_length(P) = P + n * GCM_ENVELOPE_SIZE

total_wire(P) = SMB_ENC_SIZE + ciphertext_length(P)
```

### B.2. Token 边界

```text
B_min = min(MAX_WIRE_BLOCK_SIZE, total_wire / MIN_BLOCK_DIVISOR)

m_max = min(total_wire / B_min, total_wire / SMB_ENC_SIZE)
m_min = max(1,
            ceil(total_wire / MAX_WIRE_BLOCK_SIZE),
            ceil(ciphertext_length / WIRE_BLOCK_REF_SIZE))
            -- 后一项仅在 m_max 内可行时适用
```

若 `m_min > m_max`，增大 P 后重试，直至 `original_file_length + MAX_PLAINTEXT_PADDING`；否则失败。

### B.3. 选取 m

在 `[m_min, min(m_min + MAX_TOKEN_SEARCH_WINDOW, m_max)]` 内搜索，必要时直至 `m_max`，选取满足下列条件的最小合法 m：

- `total_wire % m = 0`
- `B = total_wire / m`
- `B_min ≤ B ≤ MAX_WIRE_BLOCK_SIZE`
- `B_m = ciphertext_length - (m-1)*B` 且 `B_m + SMB_ENC_SIZE = B`

令 `plaintext_padding = P - original_file_length`。

### B.4. 填充位置

加密后的填充字节**必须**位于 C 的起始处，并**必须**映射到 Token[1..m-1]，**禁止**进入 Token[0] 的 B_m 部分。

---

## 附录 C. 资料性指南

本附录**非规范性**。

**segment_code 选择**为发送方本地策略。本规范仅要求将选定编码写入 SMB 并由对等方校验。示例策略：

| 文件大小  | 建议编码          |
| --------- | ----------------- |
| ≤ 16 MiB | 0（V2）           |
| > 16 MiB  | 4（128 MiB 分段） |

**流式处理。** V2.1 旨在支持按段缓冲；V2 隐含对完整填充明文的单次 GCM。

---

*文档结束。*
