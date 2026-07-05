#pragma once

#include <cstdint>

namespace twelve_c {

// Π_Recv_Adaptive 初始并发预取 token 数（含 Token[0]）。
// 注：较大窗口可减少 SMB 后 cancel/补拉的可观测特征。
inline constexpr std::uint32_t kDefaultInitialTokens = 64;

}  // namespace twelve_c
