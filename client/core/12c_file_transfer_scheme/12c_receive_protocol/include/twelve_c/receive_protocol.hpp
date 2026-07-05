#pragma once

#include "twelve_c/protocol_constants.hpp"
#include "twelve_c/receive_transport.hpp"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace twelve_c {

// Π_Recv_Adaptive 在获知 num_tokens 后的 token 调度计划（纯逻辑，无 I/O）。
struct ReceiveDownloadPlan {
    std::uint32_t num_tokens = 0;
    std::vector<std::string> initial_prefetch;
    std::vector<std::string> cancel_after_smb;
    std::vector<std::string> fetch_after_smb;
};

std::vector<std::string> derive_index_tokens(
    std::string_view search_code,
    std::uint32_t start_inclusive,
    std::uint32_t end_exclusive);

ReceiveDownloadPlan compute_receive_download_plan(
    std::string_view search_code,
    std::uint32_t initial_tokens,
    std::uint32_t num_tokens);

// 12C 自适应分片下载协议：预设并发 + SMB 优先 + 动态扩缩/中止，完成后委托 core 解密。
Bytes receive_adaptive(
    const std::string& credential,
    ReceiveTransport& transport,
    std::uint32_t initial_tokens = kDefaultInitialTokens);

}  // namespace twelve_c
