add_library(twelve_c_receive_protocol
    src/receive_protocol.cpp
)

target_include_directories(twelve_c_receive_protocol
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(twelve_c_receive_protocol
    PUBLIC
        twelve_c_cryptography
)

if(MSVC)
    target_compile_options(twelve_c_receive_protocol PRIVATE /W4)
else()
    target_compile_options(twelve_c_receive_protocol PRIVATE -Wall -Wextra -Wpedantic)
endif()
