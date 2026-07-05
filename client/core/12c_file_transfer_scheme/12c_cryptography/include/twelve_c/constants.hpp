#pragma once

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace twelve_c {

inline constexpr std::size_t kCredentialLength = 12;
inline constexpr std::size_t kSearchCodeLength = 6;
inline constexpr std::size_t kKeyCodeLength = 6;

inline constexpr std::string_view kSaltFixKey = "12C-v2-KEY-SALT";
inline constexpr std::string_view kSaltFixSearch = "12C-v2-SEARCH-SALT";

inline constexpr std::size_t kKeyBytes = 32;
inline constexpr std::size_t kHashBytes = 32;
inline constexpr std::size_t kSaltRandBytes = 16;
inline constexpr std::size_t kGcmNonceBytes = 12;
inline constexpr std::size_t kGcmTagBytes = 16;

inline constexpr std::size_t kGcmEnvelopeBytes = kGcmNonceBytes + kGcmTagBytes;

/** 单块 wire 上限（与 Relay maxBodyBytes 对齐）。 */
inline constexpr std::size_t kMaxWireBlockBytes = 16 * 1024 * 1024;

/** 块大小下限 = min(kMaxWireBlockBytes, total_wire / kMinBlockSizeDivisor)。 */
inline constexpr std::size_t kMinBlockSizeDivisor = 8;

/** 目标 Token 数参考切分（用于 m 软下限，实际受块大小约束截断）。 */
inline constexpr std::size_t kWireBlockRef = 4 * 1024 * 1024;

/** 在 [m_min, m_max] 内优先微调 m 使 total 整除（首选窗口）。 */
inline constexpr std::size_t kMaxTokenAdjust = 256;

/** 找不到整除 m 时，尝试追加的明文零填充上限（对齐 16MB 块边界，最坏约一条块大小）。 */
inline constexpr std::size_t kMaxPlaintextPaddingForWireLayout = 16 * 1024 * 1024;

inline constexpr std::uint32_t kSmbMagic = 0x31433232;  // "12C2"
inline constexpr std::uint8_t kSmbVersion = 2;

/** SMB v2 定长明文/密文大小（schema 固定，含 originalFileName 字段）。 */
inline constexpr std::size_t kMaxOriginalFileNameBytes = 128;
inline constexpr std::size_t kSmPlainBytes = 345;
inline constexpr std::size_t kSmEncBytes = kSmPlainBytes + kGcmEnvelopeBytes;

inline constexpr int kSlowKdfIterations = 100000;

}  // namespace twelve_c
