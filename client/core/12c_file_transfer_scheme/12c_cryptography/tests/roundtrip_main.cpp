#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"
#include "twelve_c/receiver.hpp"
#include "twelve_c/sender.hpp"
#include "twelve_c/smb_parser.hpp"

#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void check_roundtrip(const std::size_t size, const std::uint16_t segment_code) {
    twelve_c::Bytes plaintext(size);
    for (std::size_t index = 0; index < size; ++index) {
        plaintext[index] = static_cast<std::uint8_t>(index & 0xFF);
    }

    const std::string credential = "ABCDEF123456";
    const twelve_c::UploadMap uploads = twelve_c::prepare_upload(
        plaintext,
        credential,
        "roundtrip.bin",
        segment_code);

    const twelve_c::CredentialParts parts = twelve_c::split_credential(credential);
    const std::string token0_key = twelve_c::derive_upload_token(
        parts.search_code,
        twelve_c::kSaltFixSearch,
        0);
    const auto iterator = uploads.find(token0_key);
    if (iterator == uploads.end()) {
        throw std::runtime_error("token0 missing from upload map");
    }

    twelve_c::parse_smb_encrypted(credential, iterator->second);

    const twelve_c::Bytes recovered =
        twelve_c::receive_from_upload_map(credential, uploads);
    if (recovered.size() != size) {
        throw std::runtime_error("length mismatch");
    }
    for (std::size_t index = 0; index < size; ++index) {
        if (recovered[index] != plaintext[index]) {
            throw std::runtime_error("byte mismatch");
        }
    }

    std::cout << size << "B segment=" << segment_code << " OK\n";
}

}  // namespace

int main() {
    try {
        check_roundtrip(1, 0);
        check_roundtrip(5120, 0);
        check_roundtrip(1024 * 1024, 0);
        check_roundtrip(17 * 1024 * 1024, 4);
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "FAIL: " << ex.what() << '\n';
        return 1;
    }
}
