cmake_minimum_required(VERSION 3.20)
project(twelve_c_file_transfer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenSSL REQUIRED)

add_subdirectory(12c_cryptography)
add_subdirectory(12c_receive_protocol)

# 聚合目标：需要完整 12C 方案（密码学 + 接收协议）时链接此目标即可。
add_library(twelve_c INTERFACE)
target_link_libraries(twelve_c
    INTERFACE
        twelve_c_cryptography
        twelve_c_receive_protocol
)
