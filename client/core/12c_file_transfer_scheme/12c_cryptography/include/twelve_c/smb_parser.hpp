#pragma once

#include "twelve_c/types.hpp"

#include <string>

namespace twelve_c {

// 从 Token[0] 前 kSmEncBytes 解密并解析 SMB，供接收协议读取 num_tokens 等参数。
SmbMetadata parse_smb_encrypted(
    const std::string& credential,
    const Bytes& smb_encrypted);

}  // namespace twelve_c
