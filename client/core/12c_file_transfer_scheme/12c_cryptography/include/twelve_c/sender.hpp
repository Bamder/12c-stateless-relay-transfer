#pragma once

#include "twelve_c/constants.hpp"
#include "twelve_c/types.hpp"

#include <string>

namespace twelve_c {

// 纯密码学：生成 token -> 密文块，不含任何上传/路由。
// segment_code 由应用层显式传入（0 = V2 整包，1..5 = V2.1 分段）。
UploadMap prepare_upload(
    const Bytes& file_plaintext,
    const std::string& credential,
    const std::string& original_file_name,
    std::uint16_t segment_code,
    std::size_t max_wire_block_bytes = kDefaultWireBlockBytesCap);

}  // namespace twelve_c