add_library(twelve_c_cryptography
    src/crypto.cpp
    src/merkle.cpp
    src/segment.cpp
    src/smb.cpp
    src/smb_parser.cpp
    src/sender.cpp
    src/receiver.cpp
    src/receive_decrypt_session.cpp
    src/wire_layout.cpp
    src/upload_prepare_session.cpp
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

add_executable(twelve_c_roundtrip_test tests/roundtrip_main.cpp)
target_link_libraries(twelve_c_roundtrip_test PRIVATE twelve_c_cryptography)

add_executable(twelve_c_receive_decrypt_streaming_test
    tests/receive_decrypt_streaming_main.cpp)
target_link_libraries(twelve_c_receive_decrypt_streaming_test PRIVATE twelve_c_cryptography)

add_executable(twelve_c_upload_prepare_streaming_test
    tests/upload_prepare_streaming_main.cpp)
target_link_libraries(twelve_c_upload_prepare_streaming_test PRIVATE twelve_c_cryptography)
