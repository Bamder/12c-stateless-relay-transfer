#pragma once

#include "twelve_c/types.hpp"

#include <string>

namespace twelve_c {

// 纯密码学：数据已齐时解密还原，不含任何下载调度。
Bytes receive_from_upload_map(
    const std::string& credential,
    const UploadMap& uploads);

}  // namespace twelve_c

