#include "twelve_c/constants.hpp"
#include "twelve_c/receive_decrypt_session.hpp"
#include "twelve_c/receiver.hpp"
#include "twelve_c/sender.hpp"

#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

constexpr std::size_t kDrainChunkBytes = 4 * 1024 * 1024;

twelve_c::Bytes drain_all_available(twelve_c::ReceiveDecryptSession& session) {
    twelve_c::Bytes drained;
    while (true) {
        twelve_c::Bytes chunk = session.take_plaintext_chunk(kDrainChunkBytes);
        if (chunk.empty()) {
            break;
        }
        drained.insert(drained.end(), chunk.begin(), chunk.end());
    }
    return drained;
}

void check_streaming_receive(
    const twelve_c::Bytes& plaintext,
    const std::uint16_t segment_code) {
    const std::string credential = "ABCDEF123456";
    const twelve_c::UploadMap uploads = twelve_c::prepare_upload(
        plaintext,
        credential,
        "streaming.bin",
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

    const twelve_c::Bytes expected =
        twelve_c::receive_from_upload_map(credential, uploads);

    twelve_c::ReceiveDecryptSession session(credential, iterator->second);
    const auto metadata = twelve_c::parse_smb_encrypted(credential, iterator->second);
    const std::uint32_t num_tokens = metadata.num_tokens;

    twelve_c::Bytes streamed;
    for (std::uint32_t token_index = 1; token_index < num_tokens; ++token_index) {
        const std::string token_key = twelve_c::derive_upload_token(
            parts.search_code,
            twelve_c::kSaltFixSearch,
            token_index);
        const auto wire_iterator = uploads.find(token_key);
        if (wire_iterator == uploads.end()) {
            throw std::runtime_error("missing wire token in upload map");
        }
        session.add_wire_token(token_index, wire_iterator->second);

        const twelve_c::Bytes drained = drain_all_available(session);
        streamed.insert(
            streamed.end(),
            drained.begin(),
            drained.end());
    }

    session.complete_finalize();
    const twelve_c::Bytes tail = drain_all_available(session);
    streamed.insert(
        streamed.end(),
        tail.begin(),
        tail.end());

    if (streamed.size() != expected.size()) {
        throw std::runtime_error(
            "streaming length mismatch: got " + std::to_string(streamed.size()) +
            ", expected " + std::to_string(expected.size()));
    }
    for (std::size_t index = 0; index < expected.size(); ++index) {
        if (streamed[index] != expected[index]) {
            throw std::runtime_error(
                "streaming byte mismatch at offset " + std::to_string(index));
        }
    }

    std::cout << plaintext.size() << "B segment=" << segment_code << " streaming OK\n";
}

}  // namespace

int main() {
    try {
        twelve_c::Bytes small(512 * 1024);
        for (std::size_t index = 0; index < small.size(); ++index) {
            small[index] = static_cast<std::uint8_t>((index * 131) & 0xFF);
        }
        check_streaming_receive(small, 4);

        twelve_c::Bytes medium(64 * 1024 * 1024);
        for (std::size_t index = 0; index < medium.size(); ++index) {
            medium[index] = static_cast<std::uint8_t>((index * 17) & 0xFF);
        }
        check_streaming_receive(medium, 4);

        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "FAIL: " << ex.what() << '\n';
        return 1;
    }
}
