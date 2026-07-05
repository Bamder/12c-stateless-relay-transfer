add_library(twelve_c_cryptography
    src/crypto.cpp
    src/merkle.cpp
    src/smb.cpp
    src/smb_parser.cpp
    src/sender.cpp
    src/receiver.cpp
    src/wire_layout.cpp
)

target_include_directories(twelve_c_cryptography
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(twelve_c_cryptography
    PUBLIC
        OpenSSL::Crypto
)

if(MSVC)
    target_compile_options(twelve_c_cryptography PRIVATE /W4)
else()
    target_compile_options(twelve_c_cryptography PRIVATE -Wall -Wextra -Wpedantic)
endif()
