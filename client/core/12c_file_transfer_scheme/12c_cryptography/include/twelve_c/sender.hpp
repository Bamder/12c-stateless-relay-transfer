#pragma once

#include "twelve_c/types.hpp"

#include <string>

namespace twelve_c {

// 纯密码学：生成 token -> 密文块，不含任何上传/路由。
UploadMap prepare_upload(
    const Bytes& file_plaintext,
    const std::string& credential,
    const std::string& original_file_name = {});

}  // namespace twelve_c