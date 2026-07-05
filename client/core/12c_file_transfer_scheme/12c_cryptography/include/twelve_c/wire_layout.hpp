#pragma once

#include <cstddef>
#include <cstdint>

namespace twelve_c {

/**
 * 12C v2 wire 布局（无 PKCS#7、无额外 pad 字节）：
 *
 * - SMB 定长 kSmEncBytes，无长度前缀
 * - total = kSmEncBytes + |C|
 * - m >= ceil(|C| / kWireBlockRef)，微调 m 使 m * B == total 精确成立
 * - B = total / m，且 B >= min(kMaxWireBlockBytes, total / 8)
 * - B <= kMaxWireBlockBytes（Relay PUT 上限）
 * - Token[0] = S_enc || B_m（末段密文），|Token[i]| = B 对所有 i
 * - Token[1..m-1] = C 的前 m-1 段，各 B 字节
 * - Merkle 叶子 = 逻辑密文块 B_1..B_m
 * - wire 对齐用明文前缀零填充（layout.plaintext_padding），加密后落在 Token[1..]，
 *   不进入 Token[0] 末段（Token[0] = S_enc || 真实文件末段密文）
 */

std::size_t sm_enc_size();

struct WireLayout {
    std::uint32_t num_tokens = 0;
    std::uint32_t wire_block_size = 0;
    std::size_t ciphertext_length = 0;
    std::size_t total_wire_bytes = 0;
    std::size_t last_block_length = 0;
    /** 为满足整除切分在明文**前缀**追加的零填充字节数（加密后进 Token[1..]）。 */
    std::size_t plaintext_padding = 0;
};

WireLayout compute_wire_layout(std::size_t plaintext_length);

}  // namespace twelve_c
