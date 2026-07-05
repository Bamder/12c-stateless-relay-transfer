#pragma once

#include "twelve_c/types.hpp"

#include <string>
#include <vector>

namespace twelve_c {

// 12C 接收协议所需的最小传输端口：只表达「按 token 拉取/取消」，
// 不包含服务器路由、重试策略等上层 concern。
class ReceiveTransport {
public:
    virtual ~ReceiveTransport() = default;

    virtual void start_concurrent_get(const std::vector<std::string>& tokens) = 0;

    virtual void cancel_pending(const std::vector<std::string>& tokens) = 0;

    virtual Bytes get(const std::string& token) = 0;
};

}  // namespace twelve_c
