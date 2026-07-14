cmake_minimum_required(VERSION 3.20)
project(twelve_c_wasm LANGUAGES CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "twelve_c_wasm must be configured with emcmake/em++")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(TWELVE_C_CRYPTO_ROOT
    ${CMAKE_CURRENT_SOURCE_DIR}/../12c_file_transfer_scheme/12c_cryptography)

add_executable(twelve_c_cryptography
    bindings.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/crypto.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/merkle.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/segment.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/smb.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/smb_parser.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/sender.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/receiver.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/receive_decrypt_session.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/wire_layout.cpp
    ${TWELVE_C_CRYPTO_ROOT}/src/upload_prepare_session.cpp
)

target_include_directories(twelve_c_cryptography
    PRIVATE
        ${TWELVE_C_CRYPTO_ROOT}/include
)

# Emscripten has no USE_OPENSSL port (6.x). Link a wasm-built static libcrypto instead.
set(TWELVE_C_OPENSSL_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/third_party/openssl-emscripten")
set(TWELVE_C_OPENSSL_CRYPTO "${TWELVE_C_OPENSSL_ROOT}/lib/libcrypto.a")

if(NOT EXISTS "${TWELVE_C_OPENSSL_CRYPTO}")
    message(FATAL_ERROR
        "OpenSSL for Emscripten not found at ${TWELVE_C_OPENSSL_CRYPTO}. "
        "Run build-openssl-emscripten.ps1 or build-wasm.ps1 (builds it automatically).")
endif()

target_include_directories(twelve_c_cryptography
    PRIVATE
        ${TWELVE_C_OPENSSL_ROOT}/include
)

target_link_libraries(twelve_c_cryptography PRIVATE ${TWELVE_C_OPENSSL_CRYPTO})

target_compile_options(twelve_c_cryptography PRIVATE -fexceptions)

set(TWELVE_C_WASM_LINK_FLAGS
    "-fexceptions"
    "-sDISABLE_EXCEPTION_CATCHING=0"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=createTwelveCModule"
    "-sENVIRONMENT=web,worker"
    "-sALLOW_MEMORY_GROWTH=1"
    # Emscripten 6 defaults GROWABLE_ARRAYBUFFERS=1; Chrome TextDecoder rejects
    # resizable ArrayBuffer views from WASM memory (UTF8ToString in embind).
    "-sGROWABLE_ARRAYBUFFERS=0"
    "-sFILESYSTEM=0"
    "--bind"
)

target_link_options(twelve_c_cryptography PRIVATE ${TWELVE_C_WASM_LINK_FLAGS})

set_target_properties(twelve_c_cryptography PROPERTIES
    OUTPUT_NAME "twelve_c_cryptography"
    SUFFIX ".js"
)
